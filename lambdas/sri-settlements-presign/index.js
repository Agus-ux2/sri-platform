const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const s3 = new S3Client({ region: 'us-east-2' });
const BUCKET = 'sri-settlements-248825820462';

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const userId = event.requestContext && event.requestContext.authorizer && event.requestContext.authorizer.userId;
  if (!userId) {
    return { statusCode: 401, headers, body: JSON.stringify({ success: false, error: 'No autorizado' }) };
  }

  const s3Key = event.queryStringParameters && event.queryStringParameters.key;
  if (!s3Key) {
    return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Falta el parametro key' }) };
  }

  if (!s3Key.startsWith('uploads/') || s3Key.includes('..')) {
    return { statusCode: 403, headers, body: JSON.stringify({ success: false, error: 'Acceso denegado' }) };
  }

  try {
    const command = new GetObjectCommand({ Bucket: BUCKET, Key: s3Key });
    const url = await getSignedUrl(s3, command, { expiresIn: 3600 });
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, url }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
