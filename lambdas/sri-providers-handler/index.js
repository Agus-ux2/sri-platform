"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
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
// Mock providers list matching frontend (lib/provider-utils.ts)
const PROVIDERS = {
    cargill: {
        id: 'cargill',
        name: "Cargill",
        logo: "/images/logos/cargill.svg",
        color: "#419641",
        initials: "CA",
        loginUrl: "https://www.mycargill.com/cascsa/v2/login",
        status: 'disconnected'
    },
    ldc: {
        id: 'ldc',
        name: "LDC",
        logo: "/images/logos/ldc.svg",
        color: "#004D71",
        initials: "LD",
        loginUrl: "https://mildc.com/webportal",
        status: 'disconnected'
    },
    bunge: {
        id: 'bunge',
        name: "Bunge",
        logo: "/images/logos/bunge.svg",
        color: "#002D6E",
        initials: "BU",
        loginUrl: "https://operacionesbasa.bunge.ar/operacionesbasa/",
        status: 'disconnected'
    },
    cofco: {
        id: 'cofco',
        name: "COFCO",
        logo: "/images/logos/cofco.svg?v=1",
        color: "#004D71",
        initials: "CO",
        filter: "brightness(0) saturate(100%) invert(31%) sepia(91%) saturate(1450%) hue-rotate(189deg) brightness(88%) contrast(92%)",
        loginUrl: "https://ar.cofcointernational.com/acceso-clientes",
        status: 'disconnected'
    },
    fyo: {
        id: 'fyo',
        name: "FyO",
        logo: "/images/logos/fyo.png",
        color: "#002D6E",
        initials: "FyO",
        loginUrl: "https://www.fyodigital.com",
        status: 'disconnected'
    },
    aca: {
        id: 'aca',
        name: "ACA",
        logo: "/images/logos/aca.png",
        color: "#004B87",
        initials: "ACA",
        loginUrl: "https://www.acabase.com.ar/index.asp#",
        status: 'disconnected'
    }
};
const handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return response(200, { message: 'OK' });
    }
    const path = event.path || event.resource || '';
    const method = event.httpMethod;
    try {
        // GET /providers/list
        if (method === 'GET' && path.endsWith('/list')) {
            // Check auth if strictly needed, but list might be public/semi-public
            // Returning the mock object as list or object? Frontend expects array or object?
            // Frontend: `const data = await ProviderUtils.listProviders();` 
            // `ProviderUtils.listProviders` returns `API.get('/providers/list')`
            // Let's return the object mapping or array. 
            // In the original code `api/providers/controller.js` (if it existed) probably returned an array or the object.
            // Let's return the object values as array to be safe, or just the object.
            // Actually, frontend `PROVIDERS` constant is an object `Record<string, ProviderConfig>`.
            // Let's return the object.
            return response(200, PROVIDERS);
        }
        // POST /providers/connect
        if (method === 'POST' && path.endsWith('/connect')) {
            if (!event.body)
                return response(400, { error: 'No body' });
            const { provider } = JSON.parse(event.body);
            // Mock connection success
            if (PROVIDERS[provider]) {
                return response(200, { success: true, message: `Connected to ${provider}` });
            }
            return response(404, { error: 'Provider not found' });
        }
        // POST /providers/force-connect
        if (method === 'POST' && path.endsWith('/force-connect')) {
            if (!event.body)
                return response(400, { error: 'No body' });
            const { provider } = JSON.parse(event.body);
            if (PROVIDERS[provider]) {
                return response(200, { success: true, message: `Force connected to ${provider}` });
            }
            return response(404, { error: 'Provider not found' });
        }
        // DELETE /providers/delete/{id}
        if (method === 'DELETE' && path.includes('/delete/')) {
            return response(200, { success: true, message: 'Disconnected' });
        }
        return response(404, { error: 'Not found' });
    }
    catch (error) {
        console.error('Error in providers-handler:', error);
        return response(500, { error: 'Internal server error', details: error.message });
    }
};
exports.handler = handler;
