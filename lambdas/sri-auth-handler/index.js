const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const JWT_SECRET = process.env.JWT_SECRET || 'sri-secret-key-2026';
const JWT_EXPIRES_IN = '24h';

const pool = new Pool({
    host: process.env.DB_HOST || 'sri2026db.clcsiaesie50.us-east-2.rds.amazonaws.com',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'sri_production',
    user: process.env.DB_USER || 'sri_admin',
    password: process.env.DB_PASSWORD || 'Stich2009!',
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 5000 // Add timeout to fail fast
});

const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
};

function response(statusCode, body) {
    return {
        statusCode,
        headers,
        body: JSON.stringify(body)
    };
}

// Register handler
async function handleRegister(body) {
    console.log('Handling register request:', body.email);
    const { email, password, name, username, company, phone, zones } = body;

    if (!email || !password || !name || !company) {
        return response(400, { error: 'Missing required fields: email, password, name, company' });
    }

    const client = await pool.connect();
    try {
        // Check if user exists
        const checkResult = await client.query('SELECT id FROM users WHERE email = $1', [email]);
        if (checkResult.rows.length > 0) {
            return response(409, { error: 'Email already registered' });
        }

        // Hash password
        const password_hash = await bcrypt.hash(password, 10);

        // Insert user
        await client.query('BEGIN');
        const userResult = await client.query(
            `INSERT INTO users (email, password_hash, name, username, company, phone)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id, email, name, username, company, role, created_at`,
            [email, password_hash, name, username || email.split('@')[0], company, phone || null]
        );

        const user = userResult.rows[0];

        // Insert zones if provided
        if (zones && zones.length > 0) {
            for (const zone of zones) {
                await client.query(
                    'INSERT INTO production_zones (user_id, location, hectares) VALUES ($1, $2, $3)',
                    [user.id, zone.location, zone.hectares || 0]
                );
            }
        }

        await client.query('COMMIT');

        // Generate token
        const token = jwt.sign(
            { userId: user.id, email: user.email, role: user.role },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRES_IN }
        );

        return response(201, {
            success: true,
            message: 'User registered successfully',
            token,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                username: user.username,
                company: user.company,
                role: user.role
            }
        });

    } catch (error) {
        await client.query('ROLLBACK').catch(() => { });
        console.error('Register error:', error);
        return response(500, { error: 'Registration failed', details: error.message });
    } finally {
        client.release();
    }
}

// Login handler
async function handleLogin(body) {
    console.log('Handling login request:', body.email);
    const { email, password } = body;

    if (!email || !password) {
        return response(400, { error: 'Email and password are required' });
    }

    try {
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);

        if (result.rows.length === 0) {
            console.log('User not found:', email);
            return response(401, { error: 'Invalid email or password' });
        }

        const user = result.rows[0];
        const isValid = await bcrypt.compare(password, user.password_hash);

        if (!isValid) {
            console.log('Invalid password for:', email);
            return response(401, { error: 'Invalid email or password' });
        }

        // Generate token
        const token = jwt.sign(
            { userId: user.id, email: user.email, role: user.role },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRES_IN }
        );

        return response(200, {
            success: true,
            message: 'Login successful',
            token,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                username: user.username,
                company: user.company,
                role: user.role
            }
        });

    } catch (error) {
        console.error('Login error:', error);
        return response(500, { error: 'Login failed', details: error.message });
    }
}

// Get current user (from token)
async function handleGetMe(event) {
    const authHeader = event.headers?.Authorization || event.headers?.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return response(401, { error: 'No token provided' });
    }

    const token = authHeader.substring(7);

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const result = await pool.query(
            'SELECT id, email, name, username, company, role, created_at FROM users WHERE id = $1',
            [decoded.userId]
        );

        if (result.rows.length === 0) {
            return response(404, { error: 'User not found' });
        }

        return response(200, {
            success: true,
            user: result.rows[0]
        });

    } catch (error) {
        if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
            return response(401, { error: 'Invalid or expired token' });
        }
        console.error('GetMe error:', error);
        return response(500, { error: 'Failed to get user', details: error.message });
    }
}

// Main Lambda handler
exports.handler = async (event) => {
    console.log('Auth Lambda invoked:', JSON.stringify({
        method: event.httpMethod,
        path: event.path,
        resource: event.resource
    }));

    // Handle CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        return response(200, { message: 'OK' });
    }

    try {
        const path = event.path || event.resource || '';
        const method = event.httpMethod;
        let body = {};

        if (event.body) {
            try {
                body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
            } catch (e) {
                console.error('Invalid JSON body');
                return response(400, { error: 'Invalid JSON body' });
            }
        }

        // Route to appropriate handler where path ends with...
        if (path.endsWith('/login') && method === 'POST') {
            return await handleLogin(body);
        }

        if (path.endsWith('/register') && method === 'POST') {
            return await handleRegister(body);
        }

        if (path.endsWith('/me') && method === 'GET') {
            return await handleGetMe(event);
        }

        return response(404, { error: 'Not found', path, method });

    } catch (error) {
        console.error('Handler error:', error);
        return response(500, { error: 'Internal server error', details: error.message });
    }
};
