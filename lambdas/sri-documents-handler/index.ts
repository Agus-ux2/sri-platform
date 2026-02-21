
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { PrismaClient } from '@prisma/client';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

const s3Client = new S3Client({ region: process.env.AWS_REGION });
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

// Get user info from Cognito claims or custom headers
function getUserInfo(event: APIGatewayProxyEvent) {
    const claims = event.requestContext?.authorizer?.claims || {};
    // Fallback for testing/imperfect auth setup
    const userId = claims.sub || event.headers['x-user-id'];
    // For now, if no user ID, we might need to fail or use a placeholder if testing
    return { userId };
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    // Handle CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        return response(200, { message: 'OK' });
    }

    const path = event.path || event.resource || '';
    const method = event.httpMethod;

    try {
        const db = getPrisma();
        const { userId } = getUserInfo(event);

        if (!userId && process.env.NODE_ENV === 'production') {
            console.log("No userId found in claims", event.requestContext);
            return response(401, { error: 'Unauthorized: No user identity found' });
        }

        // GET /documents - List documents
        if (method === 'GET' && (path.endsWith('/documents') || path === '/documents')) {
            const documents = await db.document.findMany({
                where: { userId: userId! },
                orderBy: { createdAt: 'desc' },
                take: 20
            });
            return response(200, { documents });
        }

        // POST /documents/upload - Upload new document
        if (method === 'POST' && path.endsWith('/test-upload')) {
            // Placeholder for simple test if needed, but skipping to real upload
        }

        if (method === 'POST' && (path.endsWith('/documents/upload') || path.endsWith('/upload'))) {
            if (!event.body) {
                return response(400, { error: 'No body provided' });
            }

            let body;
            try {
                body = JSON.parse(event.body);
            } catch (e) {
                return response(400, { error: 'Invalid JSON body' });
            }

            const { file, fileName, mimeType } = body;

            if (!file || !fileName || !mimeType) {
                return response(400, { error: 'Missing required fields: file (base64), fileName, mimeType' });
            }

            // Decode base64
            // Expecting "data:application/pdf;base64,....." or just raw base64?
            // Usually frontend FileReader.readAsDataURL returns with prefix.
            let fileContent = file;
            if (file.includes(',')) {
                fileContent = file.split(',')[1];
            }

            const buffer = Buffer.from(fileContent, 'base64');
            const timestamp = Date.now();
            const s3Key = `documents/${userId}/${timestamp}-${fileName}`;

            // Upload to S3
            await s3Client.send(new PutObjectCommand({
                Bucket: process.env.SETTLEMENTS_BUCKET!,
                Key: s3Key,
                Body: buffer,
                ContentType: mimeType,
                Metadata: {
                    userId: userId!,
                    originalName: fileName
                }
            }));

            // Save to DB
            const document = await db.document.create({
                data: {
                    userId: userId!,
                    originalName: fileName,
                    filePath: `s3://${process.env.SETTLEMENTS_BUCKET}/${s3Key}`,
                    fileSize: BigInt(buffer.length),
                    mimeType: mimeType,
                    ocrStatus: 'pending' // Default status
                }
            });

            // Convert BigInt to string for JSON
            const docResponse = {
                ...document,
                fileSize: document.fileSize.toString()
            };

            return response(201, { success: true, document: docResponse });
        }

        return response(404, { error: 'Not found', path, method });

    } catch (error: any) {
        console.error('Error in documents-handler:', error);
        return response(500, { error: 'Internal server error', details: error.message });
    }
};
