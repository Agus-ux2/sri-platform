const jwt = require('jsonwebtoken');

exports.handler = async (event) => {
    console.log('Authorizer event:', JSON.stringify(event));

    try {
        // For TOKEN authorizers, the token is in event.authorizationToken
        // For REQUEST authorizers, it would be in event.headers
        const authHeader = event.authorizationToken ||
            (event.headers && (event.headers.Authorization || event.headers.authorization));
        const token = authHeader && authHeader.replace(/^Bearer\s+/, '');

        if (!token) {
            console.log('No token found in event');
            throw new Error('Unauthorized');
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'sri-secret-key-2026');

        return generatePolicy(decoded.userId, 'Allow', event.methodArn, decoded);
    } catch (err) {
        console.log('Authorization error:', err);
        return generatePolicy('user', 'Deny', event.methodArn);
    }
};

const generatePolicy = (principalId, effect, resource, context) => {
    const authResponse = {};
    authResponse.principalId = principalId.toString(); // PrincipalId must be string

    if (effect && resource) {
        authResponse.policyDocument = {
            Version: '2012-10-17',
            Statement: [{
                Action: 'execute-api:Invoke',
                Effect: effect,
                Resource: '*' // Use wildcard to avoid caching issues with specific resource ARNs
            }]
        };
    }

    // Context values must be strings, numbers, or booleans
    if (context) {
        authResponse.context = {
            userId: String(context.userId),
            email: String(context.email),
            role: String(context.role || 'user')
        };
    }

    return authResponse;
};
