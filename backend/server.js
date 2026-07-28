"use strict";

const path = require("path");
const crypto = require("crypto");

require("dotenv").config({
    path: path.join(__dirname, ".env")
});

const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");

const serviceAccount =
    require("./serviceAccountKey.json");

// --------------------------------------------------
// ENVIRONMENT VALIDATION
// --------------------------------------------------

const PORT =
    Number(process.env.PORT) || 5000;

const PASSWORD_LOOKUP_SECRET =
    String(
        process.env.PASSWORD_LOOKUP_SECRET || ""
    ).trim();

if (PASSWORD_LOOKUP_SECRET.length < 32) {
    throw new Error(
        "PASSWORD_LOOKUP_SECRET is missing or too short. " +
        "Add a random secret of at least 32 characters to backend/.env."
    );
}

// --------------------------------------------------
// FIREBASE ADMIN
// --------------------------------------------------

try {
    admin.app();
} catch (e) {
    admin.initializeApp({
        credential:
            admin.cert(serviceAccount)
    });
}

const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");

const db = getFirestore();
const firebaseAuth = getAuth();

// --------------------------------------------------
// EXPRESS
// --------------------------------------------------

const app = express();

app.disable("x-powered-by");

app.use(
    cors({
        origin: true,
        credentials: true
    })
);

app.use(
    express.json({
        limit: "100kb"
    })
);

// --------------------------------------------------
// FRONTEND
// --------------------------------------------------

const frontendPath = path.join(
    __dirname,
    "..",
    "business-tracker-frontend"
);

console.log(
    `📁 Serving frontend from: ${frontendPath}`
);

app.use(
    express.static(frontendPath)
);

// --------------------------------------------------
// CONSTANTS
// --------------------------------------------------

const USERNAME_RESERVATIONS_COLLECTION =
    "credentialUsernames";

const PASSWORD_RESERVATIONS_COLLECTION =
    "credentialPasswords";

const STAFF_ROLE = "staff";
const MANAGER_ROLE = "manager";

const ALLOWED_USERNAME_PATTERN =
    /^[a-z0-9._-]{3,40}$/;

const ALLOWED_STAFF_ROLE_TITLES = new Set([
    "Chef",
    "Front Desk",
    "Housekeeping",
    "Waiter",
    "Security",
    "Maintenance",
    "Receptionist",
    "Supervisor",
    "Accountant",
    "Manager Assistant",
    "Custom"
]);

// --------------------------------------------------
// ERROR CLASS
// --------------------------------------------------

class HttpError extends Error {
    constructor(
        status,
        message,
        code = "request-failed"
    ) {
        super(message);

        this.name = "HttpError";
        this.status = status;
        this.code = code;
    }
}

// --------------------------------------------------
// GENERAL HELPERS
// --------------------------------------------------

function asyncRoute(handler) {
    return function wrappedRoute(
        request,
        response,
        next
    ) {
        Promise.resolve(
            handler(
                request,
                response,
                next
            )
        ).catch(next);
    };
}

function normaliseText(value) {
    return String(value || "").trim();
}

function normaliseUsername(value) {
    return normaliseText(value)
        .toLowerCase();
}

function normaliseEmail(value) {
    return normaliseText(value)
        .toLowerCase();
}

function formatRoleTitle(value) {
    return normaliseText(value)
        .split(/[-_]/)
        .filter(Boolean)
        .map(part =>
            part.charAt(0).toUpperCase() +
            part.slice(1).toLowerCase()
        )
        .join(" ");
}

function createSha256(value) {
    return crypto
        .createHash("sha256")
        .update(value)
        .digest("hex");
}

/**
 * Passwords are never stored.
 *
 * The server stores only an HMAC fingerprint generated
 * with a private backend secret.
 */
function createPasswordFingerprint(password) {
    return crypto
        .createHmac(
            "sha256",
            PASSWORD_LOOKUP_SECRET
        )
        .update(password)
        .digest("hex");
}

function buildSyntheticEmail(username) {
    return `${username}@business.local`;
}

function isValidContactEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/
        .test(email);
}

function validateStaffPayload(body) {
    const name =
        normaliseText(body.name);

    const requestedRoleTitle =
        normaliseText(body.roleTitle);

    const customRoleTitle =
        normaliseText(body.customRoleTitle);

    const email =
        normaliseEmail(body.email);

    const phone =
        normaliseText(body.phone);

    const username =
        normaliseUsername(body.username);

    const password =
        String(body.password || "");

    if (name.length < 2 || name.length > 100) {
        throw new HttpError(
            400,
            "Name must contain between 2 and 100 characters.",
            "invalid-name"
        );
    }

    if (!requestedRoleTitle) {
        throw new HttpError(
            400,
            "Please select a staff role.",
            "invalid-role-title"
        );
    }

    if (
        requestedRoleTitle !== "Custom" &&
        !ALLOWED_STAFF_ROLE_TITLES.has(
            requestedRoleTitle
        )
    ) {
        throw new HttpError(
            400,
            "The selected staff role is invalid.",
            "invalid-role-title"
        );
    }

    let roleTitle =
        requestedRoleTitle;

    if (requestedRoleTitle === "Custom") {
        if (
            customRoleTitle.length < 2 ||
            customRoleTitle.length > 60
        ) {
            throw new HttpError(
                400,
                "Enter a custom role containing between 2 and 60 characters.",
                "invalid-custom-role"
            );
        }

        roleTitle =
            customRoleTitle;
    }

    if (!isValidContactEmail(email)) {
        throw new HttpError(
            400,
            "Enter a valid contact email address.",
            "invalid-contact-email"
        );
    }

    if (phone.length < 5 || phone.length > 30) {
        throw new HttpError(
            400,
            "Enter a valid phone number.",
            "invalid-phone"
        );
    }

    if (
        !ALLOWED_USERNAME_PATTERN.test(username)
    ) {
        throw new HttpError(
            400,
            "Username must contain 3–40 lowercase letters, numbers, dots, underscores or hyphens.",
            "invalid-username"
        );
    }

    if (
        username === "owner" ||
        username === "admin"
    ) {
        throw new HttpError(
            409,
            "Username already taken",
            "username-taken"
        );
    }

    if (password.length < 8) {
        throw new HttpError(
            400,
            "Password must contain at least 8 characters.",
            "weak-password"
        );
    }

    if (password.length > 128) {
        throw new HttpError(
            400,
            "Password is too long.",
            "invalid-password"
        );
    }

    return {
        name,
        roleTitle,
        email,
        phone,
        username,
        password
    };
}

function validateStaffAccountPayload(
    body,
    hrStaff
) {
    const trustedRoleTitle =
        normaliseText(
            hrStaff.roleTitle ||
            hrStaff.role
        ) ||
        formatRoleTitle(
            hrStaff.department
        ) ||
        "Staff";

    return validateStaffPayload({
        name: hrStaff.name,
        roleTitle:
            ALLOWED_STAFF_ROLE_TITLES.has(
                trustedRoleTitle
            )
                ? trustedRoleTitle
                : "Custom",
        customRoleTitle:
            trustedRoleTitle,
        email: hrStaff.email,
        phone: hrStaff.phone,
        username: body.username,
        password: body.password
    });
}

// --------------------------------------------------
// AUTHENTICATION MIDDLEWARE
// --------------------------------------------------

async function requireManager(
    request,
    response,
    next
) {
    try {
        const authorizationHeader =
            String(
                request.headers.authorization || ""
            );

        if (
            !authorizationHeader.startsWith(
                "Bearer "
            )
        ) {
            throw new HttpError(
                401,
                "Authentication required.",
                "missing-auth-token"
            );
        }

        const idToken =
            authorizationHeader
                .slice("Bearer ".length)
                .trim();

        if (!idToken) {
            throw new HttpError(
                401,
                "Authentication required.",
                "missing-auth-token"
            );
        }

        const decodedToken =
            await firebaseAuth.verifyIdToken(
                idToken
            );

        const managerDocument =
            await db
                .collection("users")
                .doc(decodedToken.uid)
                .get();

        if (!managerDocument.exists) {
            throw new HttpError(
                403,
                "Your user profile is missing.",
                "missing-user-profile"
            );
        }

        const managerProfile =
            managerDocument.data() || {};

        if (
            managerProfile.role !==
            MANAGER_ROLE
        ) {
            throw new HttpError(
                403,
                "Manager permission is required.",
                "manager-required"
            );
        }

        if (!managerProfile.hotelId) {
            throw new HttpError(
                403,
                "Your manager account does not have an assigned hotel.",
                "missing-hotel"
            );
        }

        request.managerContext = {
            uid: decodedToken.uid,
            email:
                decodedToken.email || "",
            hotelId:
                managerProfile.hotelId,
            profile:
                managerProfile
        };

        next();
    } catch (error) {
        next(error);
    }
}

// --------------------------------------------------
// CREDENTIAL RESERVATIONS
// --------------------------------------------------

function getCredentialReferences(
    username,
    password
) {
    const usernameKey =
        createSha256(username);

    const passwordKey =
        createPasswordFingerprint(
            password
        );

    return {
        usernameReference:
            db
                .collection(
                    USERNAME_RESERVATIONS_COLLECTION
                )
                .doc(usernameKey),

        passwordReference:
            db
                .collection(
                    PASSWORD_RESERVATIONS_COLLECTION
                )
                .doc(passwordKey)
    };
}

async function reserveCredentials({
    username,
    password,
    managerUid,
    hotelId,
    staffReference
}) {
    const {
        usernameReference,
        passwordReference
    } = getCredentialReferences(
        username,
        password
    );

    await db.runTransaction(
        async transaction => {
            const [
                usernameDocument,
                passwordDocument,
                staffDocument
            ] = await Promise.all([
                transaction.get(
                    usernameReference
                ),
                transaction.get(
                    passwordReference
                ),
                transaction.get(
                    staffReference
                )
            ]);

            if (!staffDocument.exists) {
                throw new HttpError(
                    404,
                    "The selected HR Staff record no longer exists.",
                    "staff-not-found"
                );
            }

            const staffData =
                staffDocument.data() || {};

            if (staffData.hotelId !== hotelId) {
                throw new HttpError(
                    403,
                    "The selected HR Staff record is not assigned to your hotel.",
                    "staff-hotel-mismatch"
                );
            }

            if (
                staffData.hasLoginAccount ||
                staffData.loginUid ||
                staffData.loginAccountStatus ===
                    "pending"
            ) {
                throw new HttpError(
                    409,
                    "This Staff member already has a login account.",
                    "staff-login-exists"
                );
            }

            if (usernameDocument.exists) {
                throw new HttpError(
                    409,
                    "Username already taken",
                    "username-taken"
                );
            }

            if (passwordDocument.exists) {
                throw new HttpError(
                    409,
                    "Password already taken",
                    "password-taken"
                );
            }

            transaction.create(
                usernameReference,
                {
                    username,
                    status: "pending",
                    createdBy: managerUid,
                    hotelId,
                    createdAt:
                        FieldValue
                            .serverTimestamp()
                }
            );

            transaction.create(
                passwordReference,
                {
                    algorithm:
                        "hmac-sha256",
                    status: "pending",
                    createdBy: managerUid,
                    hotelId,
                    createdAt:
                        FieldValue
                            .serverTimestamp()
                }
            );

            transaction.update(
                staffReference,
                {
                    loginAccountStatus:
                        "pending",
                    loginReservedBy:
                        managerUid,
                    loginReservedAt:
                        FieldValue
                            .serverTimestamp()
                }
            );
        }
    );

    return {
        usernameReference,
        passwordReference
    };
}

async function removePendingReservations(
    usernameReference,
    passwordReference,
    staffReference,
    managerUid
) {
    try {
        await db.runTransaction(
            async transaction => {
                const staffDocument =
                    await transaction.get(
                        staffReference
                    );

                transaction.delete(
                    usernameReference
                );

                transaction.delete(
                    passwordReference
                );

                if (staffDocument.exists) {
                    const staffData =
                        staffDocument.data() || {};

                    if (
                        staffData
                            .loginAccountStatus ===
                            "pending" &&
                        staffData.loginReservedBy ===
                            managerUid
                    ) {
                        transaction.update(
                            staffReference,
                            {
                                loginAccountStatus:
                                    FieldValue
                                        .delete(),
                                loginReservedBy:
                                    FieldValue
                                        .delete(),
                                loginReservedAt:
                                    FieldValue
                                        .delete()
                            }
                        );
                    }
                }
            }
        );
    } catch (error) {
        console.error(
            "Unable to clean credential reservations:",
            error
        );
    }
}

// --------------------------------------------------
// ROUTES
// --------------------------------------------------

app.get(
    "/",
    (request, response) => {
        response.sendFile(
            path.join(
                frontendPath,
                "index.html"
            )
        );
    }
);

app.get(
    "/api/test",
    (request, response) => {
        response.json({
            success: true,
            message:
                "Business Tracker API is running! 🚀"
        });
    }
);

app.post(
    "/api/signup",
    asyncRoute(
        async (
            request,
            response
        ) => {
            const body = request.body || {};
            const username = normaliseUsername(body.username);
            const password = String(body.password || "");
            const businessName = normaliseText(body.businessName);
            const city = normaliseText(body.city);

            if (!username || !password || !businessName || !city) {
                throw new HttpError(
                    400,
                    "Please fill in all fields.",
                    "missing-fields"
                );
            }

            if (
                !ALLOWED_USERNAME_PATTERN.test(username)
            ) {
                throw new HttpError(
                    400,
                    "Username must contain 3-40 lowercase letters, numbers, dots, underscores or hyphens.",
                    "invalid-username"
                );
            }

            if (
                username === "owner" ||
                username === "admin"
            ) {
                throw new HttpError(
                    409,
                    "Username already taken",
                    "username-taken"
                );
            }

            if (password.length < 8) {
                throw new HttpError(
                    400,
                    "Password must contain at least 8 characters.",
                    "weak-password"
                );
            }

            if (password.length > 128) {
                throw new HttpError(
                    400,
                    "Password is too long.",
                    "invalid-password"
                );
            }

            if (businessName.length < 2 || businessName.length > 100) {
                throw new HttpError(
                    400,
                    "Business name must contain between 2 and 100 characters.",
                    "invalid-business-name"
                );
            }

            if (city.length < 2 || city.length > 100) {
                throw new HttpError(
                    400,
                    "City name must contain between 2 and 100 characters.",
                    "invalid-city"
                );
            }

            const syntheticEmail = buildSyntheticEmail(username);

            // Generate unique user doc ID first so we can tie Auth uid and Firestore users collection doc id together.
            const userRef = db.collection("users").doc();
            const userUid = userRef.id;

            let createdAuthUser = null;
            let usernameReference = null;
            let passwordReference = null;
            let credentialsReserved = false;

            try {
                // Reserve credentials in transaction
                const reservations = await reserveCredentials({
                    username,
                    password,
                    managerUid: userUid,
                    hotelId: userUid
                });

                usernameReference = reservations.usernameReference;
                passwordReference = reservations.passwordReference;
                credentialsReserved = true;

                // Create Auth user
                createdAuthUser = await firebaseAuth.createUser({
                    uid: userUid,
                    email: syntheticEmail,
                    password,
                    displayName: businessName,
                    disabled: false
                });

                // Set Firestore profile documents
                const batch = db.batch();

                batch.create(userRef, {
                    role: MANAGER_ROLE,
                    hotelId: userUid,
                    username,
                    businessName,
                    city,
                    email: syntheticEmail,
                    createdAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp()
                });

                const hotelRef = db.collection("hotels").doc(userUid);
                batch.create(hotelRef, {
                    name: businessName,
                    city,
                    managerId: userUid,
                    createdAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp()
                });

                batch.update(usernameReference, {
                    status: "active",
                    uid: userUid,
                    activatedAt: FieldValue.serverTimestamp()
                });

                batch.update(passwordReference, {
                    status: "active",
                    uid: userUid,
                    activatedAt: FieldValue.serverTimestamp()
                });

                await batch.commit();

                response.status(201).json({
                    success: true,
                    message: "Manager signup completed successfully.",
                    uid: userUid
                });

            } catch (error) {
                // Rollback Auth User
                if (createdAuthUser) {
                    try {
                        await firebaseAuth.deleteUser(userUid);
                    } catch (deleteAuthError) {
                        console.error("Unable to roll back Firebase Auth user during signup failure:", deleteAuthError);
                    }
                }

                // Rollback Credential Reservations
                if (credentialsReserved && usernameReference && passwordReference) {
                    await removePendingReservations(usernameReference, passwordReference);
                }

                // Map firebase auth error codes to HTTP responses
                if (
                    error.code === "auth/email-already-exists" ||
                    error.code === "auth/uid-already-exists"
                ) {
                    throw new HttpError(
                        409,
                        "Username already taken",
                        "username-taken"
                    );
                }

                throw error;
            }
        }
    )
);



/**
 * List staff login accounts for the authenticated
 * manager's own hotel.
 */
app.get(
    "/api/staff",
    requireManager,
    asyncRoute(
        async (
            request,
            response
        ) => {
            const {
                hotelId
            } = request.managerContext;

            /*
             * Query by hotelId only so this does not require
             * a composite role + hotelId Firestore index.
             */
            const snapshot =
                await db
                    .collection("users")
                    .where(
                        "hotelId",
                        "==",
                        hotelId
                    )
                    .get();

            const staffAccounts = [];
            const linkedStaffIds =
                new Set();

            snapshot.forEach(document => {
                const data =
                    document.data() || {};

                if (
                    data.role !==
                    STAFF_ROLE
                ) {
                    return;
                }

                staffAccounts.push({
                    uid:
                        document.id,
                    name:
                        data.name || "",
                    roleTitle:
                        data.roleTitle || "",
                    email:
                        data.email || "",
                    phone:
                        data.phone || "",
                    username:
                        data.username || "",
                    hotelId:
                        data.hotelId,
                    staffId:
                        data.staffId || "",
                    createdAt:
                        data.createdAt &&
                        typeof data.createdAt
                            .toDate ===
                            "function"
                            ? data.createdAt
                                .toDate()
                                .toISOString()
                            : null
                });

                if (data.staffId) {
                    linkedStaffIds.add(
                        data.staffId
                    );
                }
            });

            const hrStaffSnapshot =
                await db
                    .collection("staff")
                    .where(
                        "hotelId",
                        "==",
                        hotelId
                    )
                    .get();

            const hrStaff = [];

            hrStaffSnapshot.forEach(document => {
                const data =
                    document.data() || {};

                const hasLoginAccount =
                    Boolean(
                        data.hasLoginAccount ||
                        data.loginUid ||
                        linkedStaffIds.has(
                            document.id
                        )
                    );

                hrStaff.push({
                    staffId:
                        document.id,
                    name:
                        data.name || "",
                    roleTitle:
                        normaliseText(
                            data.roleTitle ||
                            data.role
                        ) ||
                        formatRoleTitle(
                            data.department
                        ) ||
                        "Staff",
                    email:
                        data.email || "",
                    phone:
                        data.phone || "",
                    hasLoginAccount
                });
            });

            staffAccounts.sort(
                (
                    first,
                    second
                ) => {
                    return String(
                        first.name
                    ).localeCompare(
                        String(
                            second.name
                        )
                    );
                }
            );

            hrStaff.sort((first, second) =>
                String(first.name)
                    .localeCompare(
                        String(second.name)
                    )
            );

            response.json({
                success: true,
                hotelId,
                staff:
                    staffAccounts,
                hrStaff
            });
        }
    )
);

/**
 * Create a real Firebase Auth staff account.
 *
 * The requester must be a manager.
 * hotelId always comes from the manager's Firestore
 * profile and is never trusted from the browser.
 */
app.post(
    "/api/staff",
    requireManager,
    asyncRoute(
        async (
            request,
            response
        ) => {
            const {
                uid: managerUid,
                hotelId
            } = request.managerContext;

            const staffId =
                normaliseText(
                    request.body &&
                    request.body.staffId
                );

            if (!staffId) {
                throw new HttpError(
                    400,
                    "Select an HR Staff member.",
                    "staff-required"
                );
            }

            const staffReference =
                db
                    .collection("staff")
                    .doc(staffId);

            const staffDocument =
                await staffReference.get();

            if (!staffDocument.exists) {
                throw new HttpError(
                    404,
                    "The selected HR Staff record does not exist.",
                    "staff-not-found"
                );
            }

            const hrStaff =
                staffDocument.data() || {};

            if (hrStaff.hotelId !== hotelId) {
                throw new HttpError(
                    403,
                    "The selected HR Staff record is not assigned to your hotel.",
                    "staff-hotel-mismatch"
                );
            }

            const existingLoginSnapshot =
                await db
                    .collection("users")
                    .where(
                        "staffId",
                        "==",
                        staffId
                    )
                    .limit(1)
                    .get();

            if (
                hrStaff.hasLoginAccount ||
                hrStaff.loginUid ||
                !existingLoginSnapshot.empty
            ) {
                throw new HttpError(
                    409,
                    "This Staff member already has a login account.",
                    "staff-login-exists"
                );
            }

            const {
                name,
                roleTitle,
                email,
                phone,
                username,
                password
            } = validateStaffAccountPayload(
                request.body || {},
                hrStaff
            );

            const syntheticEmail =
                buildSyntheticEmail(
                    username
                );

            let createdAuthUser = null;
            let usernameReference = null;
            let passwordReference = null;
            let credentialsReserved = false;

            try {
                const reservations =
                    await reserveCredentials({
                        username,
                        password,
                        managerUid,
                        hotelId,
                        staffReference
                    });

                usernameReference =
                    reservations
                        .usernameReference;

                passwordReference =
                    reservations
                        .passwordReference;

                credentialsReserved = true;

                /*
                 * Firebase Auth is also globally unique by
                 * synthetic email.
                 */
                createdAuthUser =
                    await firebaseAuth
                        .createUser({
                            email:
                                syntheticEmail,
                            password,
                            displayName:
                                name,
                            disabled:
                                false
                        });

                const userReference =
                    db
                        .collection("users")
                        .doc(
                            createdAuthUser.uid
                        );

                const writeBatch =
                    db.batch();

                /*
                 * Create the role document in the same
                 * successful operation as finalising the
                 * credential reservations.
                 */
                writeBatch.create(
                    userReference,
                    {
                        role:
                            STAFF_ROLE,
                        hotelId,
                        staffId:
                            staffId,
                        name,
                        roleTitle,
                        email,
                        phone,
                        username,
                        authEmail:
                            syntheticEmail,
                        createdBy:
                            managerUid,
                        createdAt:
                            FieldValue
                                .serverTimestamp(),
                        updatedAt:
                            FieldValue
                                .serverTimestamp()
                    }
                );

                writeBatch.update(
                    usernameReference,
                    {
                        status:
                            "active",
                        uid:
                            createdAuthUser.uid,
                        activatedAt:
                            FieldValue
                                .serverTimestamp()
                    }
                );

                writeBatch.update(
                    passwordReference,
                    {
                        status:
                            "active",
                        uid:
                            createdAuthUser.uid,
                        activatedAt:
                            FieldValue
                                .serverTimestamp()
                    }
                );

                writeBatch.update(
                    staffReference,
                    {
                        loginUid:
                            createdAuthUser.uid,
                        hasLoginAccount:
                            true,
                        loginAccountStatus:
                            "active",
                        loginLinkedAt:
                            FieldValue
                                .serverTimestamp(),
                        loginReservedBy:
                            FieldValue
                                .delete(),
                        loginReservedAt:
                            FieldValue
                                .delete()
                    }
                );

                await writeBatch.commit();

                response.status(201).json({
                    success: true,
                    message:
                        "Staff account created successfully.",
                    staff: {
                        uid:
                            createdAuthUser.uid,
                        name,
                        roleTitle,
                        email,
                        phone,
                            username,
                            hotelId,
                            staffId
                    }
                });
            } catch (error) {
                /*
                 * If Auth was created but Firestore failed,
                 * delete the Auth account to avoid a logged-in
                 * user with no users/{uid} role document.
                 */
                if (createdAuthUser) {
                    try {
                        await firebaseAuth
                            .deleteUser(
                                createdAuthUser.uid
                            );
                    } catch (
                        deleteAuthError
                    ) {
                        console.error(
                            "Unable to roll back Firebase Auth user:",
                            deleteAuthError
                        );
                    }
                }

                if (
                    credentialsReserved &&
                    usernameReference &&
                    passwordReference
                ) {
                    await removePendingReservations(
                        usernameReference,
                        passwordReference,
                        staffReference,
                        managerUid
                    );
                }

                if (
                    error.code ===
                        "auth/email-already-exists" ||
                    error.code ===
                        "auth/uid-already-exists"
                ) {
                    throw new HttpError(
                        409,
                        "Username already taken",
                        "username-taken"
                    );
                }

                if (
                    error.code ===
                    "auth/invalid-password"
                ) {
                    throw new HttpError(
                        400,
                        "The generated password is invalid.",
                        "invalid-password"
                    );
                }

                throw error;
            }
        }
    )
);

// --------------------------------------------------
// NOT FOUND
// --------------------------------------------------

app.use(
    "/api",
    (
        request,
        response
    ) => {
        response.status(404).json({
            success: false,
            error:
                "API route not found.",
            code:
                "not-found"
        });
    }
);

// --------------------------------------------------
// ERROR HANDLER
// --------------------------------------------------

app.use(
    (
        error,
        request,
        response,
        next
    ) => {
        console.error(
            "API error:",
            {
                message:
                    error.message,
                code:
                    error.code,
                path:
                    request.path
            }
        );

        if (
            error.code ===
            "auth/id-token-expired"
        ) {
            response.status(401).json({
                success: false,
                error:
                    "Your login session has expired. Please sign in again.",
                code:
                    "token-expired"
            });

            return;
        }

        if (
            error.code ===
                "auth/argument-error" ||
            error.code ===
                "auth/invalid-id-token"
        ) {
            response.status(401).json({
                success: false,
                error:
                    "Your authentication token is invalid.",
                code:
                    "invalid-auth-token"
            });

            return;
        }

        const status =
            Number(error.status) || 500;

        response.status(status).json({
            success: false,
            error:
                status >= 500
                    ? "An unexpected server error occurred."
                    : error.message,
            code:
                error.code ||
                "server-error"
        });
    }
);

// --------------------------------------------------
// START SERVER
// --------------------------------------------------

app.listen(
    PORT,
    () => {
        console.log(
            `✅ Server running on http://localhost:${PORT}`
        );

        console.log(
            "🔐 Staff account API is ready."
        );
    }
);
