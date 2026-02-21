const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { randomUUID } = require('crypto');

const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-2' });
const BUCKET = process.env.S3_BUCKET || 'sri-settlements-248825820462';

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const userId = event.requestContext && event.requestContext.authorizer && event.requestContext.authorizer.userId;
  if (!userId) {
    return { statusCode: 401, headers, body: JSON.stringify({ success: false, error: 'No autorizado' }) };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const pdfs = body.pdfs;

    if (!Array.isArray(pdfs) || pdfs.length === 0) {
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Se requiere array pdfs con al menos un elemento' }) };
    }

    const batchId = randomUUID();
    const resultados = [];

    for (const pdf of pdfs) {
      const { filename, data } = pdf;
      if (!filename || !data) {
        resultados.push({ filename: filename || 'unknown', success: false, error: 'Falta filename o data' });
        continue;
      }

      try {
        const buffer = Buffer.from(data, 'base64');
        const key = `uploads/${batchId}/${filename}`;

        await s3.send(new PutObjectCommand({
          Bucket: BUCKET, Key: key, Body: buffer,
          ContentType: 'application/pdf',
          Metadata: { originalname: filename, batchid: batchId, userid: userId },
        }));

        resultados.push({ filename, success: true, key, bucket: BUCKET });
      } catch (err) {
        resultados.push({ filename, success: false, error: err.message });
      }
    }

    const ok     = resultados.filter(r => r.success).length;
    const failed = resultados.filter(r => !r.success).length;

    return {
      statusCode: 200, headers,
      body: JSON.stringify({ success: true, batchId, resumen: { total: pdfs.length, subidos: ok, errores: failed }, resultados })
    };
  } catch (err) {
    console.error('Error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
