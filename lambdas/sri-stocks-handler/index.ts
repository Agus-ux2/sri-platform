
import { PrismaClient } from '@prisma/client';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

let prisma: PrismaClient | null = null;

function getPrisma(): PrismaClient {
    if (!prisma) {
        prisma = new PrismaClient();
    }
    return prisma;
}

const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
};

function response(statusCode: number, body: any): APIGatewayProxyResult {
    return {
        statusCode,
        headers,
        body: JSON.stringify(body)
    };
}

function getUserInfo(event: APIGatewayProxyEvent) {
    const claims = event.requestContext?.authorizer?.claims || {};
    const userId = claims.sub || event.headers['x-user-id'];
    return { userId };
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    if (event.httpMethod === 'OPTIONS') {
        return response(200, { message: 'OK' });
    }

    const method = event.httpMethod;

    try {
        const db = getPrisma();
        const { userId } = getUserInfo(event);

        if (!userId && process.env.NODE_ENV === 'production') {
            return response(401, { error: 'Unauthorized' });
        }

        // GET /stocks
        if (method === 'GET') {
            const stocks = await db.grainStock.findMany({
                where: { userId: userId! },
                include: {
                    productionZone: true
                }
            });

            // Map back to snake_case for frontend if needed? 
            // The frontend code maps FROM snake_case in fetchStocks:
            // return response.map((item: any) => ({ ... item.grain_type ... }))
            // So we should return snake_case objects or let frontend configure it.
            // Let's return snake_case to match frontend expectation.

            const formattedStocks = stocks.map(s => ({
                id: s.id,
                user_id: s.userId,
                production_zone_id: s.productionZoneId,
                grain_type: s.grainType,
                campaign: s.campaign,
                initial_stock: s.initialStock,
                sold_delivered: s.soldDelivered,
                livestock_consumption: s.livestockConsumption,
                seeds: s.seeds,
                extruder_own: s.extruderOwn,
                extruder_exchange: s.extruderExchange,
                exchanges: s.exchanges,
                committed_sales: s.committedSales,
                establishment: s.productionZone?.location || 'Unknown'
            }));

            return response(200, formattedStocks);
        }

        // POST /stocks
        if (method === 'POST') {
            if (!event.body) return response(400, { error: 'No body' });

            const body = JSON.parse(event.body);

            // Upsert based on unique constraint: [productionZoneId, grainType, campaign]
            // Payload keys are snake_case from frontend

            const {
                production_zone_id,
                grain_type,
                campaign,
                initial_stock,
                sold_delivered,
                livestock_consumption,
                seeds,
                extruder_own,
                extruder_exchange,
                exchanges,
                committed_sales
            } = body;

            if (!production_zone_id || !grain_type || !campaign) {
                return response(400, { error: 'Missing required keys' });
            }

            const stock = await db.grainStock.upsert({
                where: {
                    productionZoneId_grainType_campaign: {
                        productionZoneId: production_zone_id,
                        grainType: grain_type,
                        campaign: campaign
                    }
                },
                update: {
                    initialStock: initial_stock,
                    soldDelivered: sold_delivered,
                    livestockConsumption: livestock_consumption,
                    seeds: seeds,
                    extruderOwn: extruder_own,
                    extruderExchange: extruder_exchange,
                    exchanges: exchanges,
                    committedSales: committed_sales,
                    userId: userId! // ensure userId is kept or updated
                },
                create: {
                    userId: userId!,
                    productionZoneId: production_zone_id,
                    grainType: grain_type,
                    campaign: campaign,
                    initialStock: initial_stock || 0,
                    soldDelivered: sold_delivered || 0,
                    livestockConsumption: livestock_consumption || 0,
                    seeds: seeds || 0,
                    extruderOwn: extruder_own || 0,
                    extruderExchange: extruder_exchange || 0,
                    exchanges: exchanges || 0,
                    committedSales: committed_sales || 0
                }
            });

            return response(200, { success: true, stock });
        }

        return response(404, { error: 'Not found' });

    } catch (error: any) {
        console.error('Error in stocks-handler:', error);
        return response(500, { error: 'Internal server error', details: error.message });
    }
};
