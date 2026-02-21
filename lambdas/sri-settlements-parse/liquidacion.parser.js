
const { PDFParse } = require('pdf-parse');
const pdfParseBuffer = async (buffer) => { const p = new PDFParse({ data: buffer }); return await p.getText(); };

const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();

const toNum = (s) => {
  if (!s) return null;
  const c = s.replace(/[$\s]/g, '');
  if (c.includes(',') && c.includes('.')) return parseFloat(c.replace(/,/g, '')) || null;
  if (c.includes(',') && !c.includes('.')) return parseFloat(c.replace(',', '.')) || null;
  return parseFloat(c) || null;
};

const extractNum = (text, pattern) => {
  const m = text.match(pattern);
  return m ? toNum(m[1]) : null;
};

const extractStr = (text, pattern) => {
  const m = text.match(pattern);
  return m ? clean(m[1]) : null;
};

const getTipo = (text) => {
  if (/Ajuste unificado/i.test(text)) return 'ajuste';
  if (/Tipo de operaci[oó]n:\s*1/i.test(text)) return 'primaria';
  return 'otro';
};

const parseEncabezado = (text) => ({
  coe:            extractStr(text, /C\.O\.E\.:\s*(\d+)/),
  coe_original:   extractStr(text, /COE ORIGINAL:\s*(\d+)/),
  tipo_operacion: getTipo(text),
  fecha:          extractStr(text, /(\d{2}\/\d{2}\/\d{4}),\s*[A-Z]/),
  lugar:          extractStr(text, /\d{2}\/\d{2}\/\d{4},\s*([A-Z ]+)\n/),
});

const parsePartes = (text) => {
  const cuits   = [...text.matchAll(/C\.U\.I\.T\.:\s*(\d+)/g)].map(m => m[1]);
  const razones = [...text.matchAll(/Raz[oó]n Social:\s*([^\n]+)/gi)].map(m => clean(m[1]));
  return {
    comprador_cuit:         cuits[0] || null,
    comprador_razon_social: razones[0] || null,
    vendedor_cuit:          cuits[1] || null,
    vendedor_razon_social:  razones[1] || null,
  };
};

const parseCondiciones = (text) => {
  const grano_m = text.match(/(\d{2})\s*-\s*(CEBADA FORRAJERA|TRIGO PAN|TRIGO DURO|MAIZ|SOJA|SORGO|GIRASOL)/i);
  // Línea 51: "$ 265872.42G211 - CEBADA FORRAJERA$ 43397.97"
  // precio=265872.42, grado=G2, flete=43397.97
  const cond_m  = text.match(/\$\s*([\d.]+)(G[12]|FG)\d{2}\s*-\s*[A-Z ]+\$\s*([\d.]+)/);
  const grado_m = text.match(/\$\s*[\d.]+(G[12]|FG)\d/);
  return {
    grano_codigo:   grano_m ? grano_m[1]      : null,
    grano_tipo:     grano_m ? clean(grano_m[0]) : null,
    grado:          grado_m ? grado_m[1]      : null,
    precio_tn:      cond_m  ? parseFloat(cond_m[1]) : null,
    flete_tn:       cond_m  ? parseFloat(cond_m[3]) : null,
    puerto:         extractStr(text, /Puerto\s*\n([A-Z ]+)\n/i),
    fecha_contrato: extractStr(text, /Fecha:\s*(\d{2}\/\d{2}\/\d{4})/),
  };
};

const parseOperacion = (text) => {
  // "59361 Kg$218.09$12946250.3010.5$1359356.28$14305606.58
  const op_m  = text.match(/([\d,]+)\s*Kg\s*\$\s*([\d.]+)\s*\$\s*([\d.,]+?)\s*(10\.5|10,5)\s*\$\s*([\d.,]+)\s*\$\s*([\d.,]+)/);
  // "$ 0.00Total Deducciones:" → valor ANTES del label
  const ded_m = text.match(/\$\s*([\d.,]+)Total Deducciones:/i);
  // "Total Percepciones:$ 0.00"
  const per_m = text.match(/Total Percepciones:\$\s*([\d.,]+)/i);
  // "IVA RG 4310/2018:\n$ 1,359,356.28"
  const iva_m = text.match(/IVA RG[^:]*:\s*\n\$\s*([\d.,]+)/i);
  // "Importe Neto a Pagar:\n$ 14,305,606.58"  
  const neto_m = text.match(/Importe Neto a Pagar:\s*\n\$\s*([\d.,]+)/i);
  // "Pago según condiciones:$ 12,946,250.30"
  const pago_m = text.match(/Pago seg[uú]n condiciones:\$\s*([\d.,]+)/i);
  const tot_op = op_m ? toNum(op_m[6]) : null;

  return {
    cantidad_kg:        op_m   ? toNum(op_m[1])       : null,
    precio_kg:          op_m   ? parseFloat(op_m[2])  : null,
    subtotal:           op_m   ? toNum(op_m[3])       : null,
    iva_alicuota:       10.5,
    iva_importe:        op_m   ? toNum(op_m[5])       : null,
    total_operacion:    tot_op,
    total_deducciones:  ded_m  ? toNum(ded_m[1])      : null,
    total_percepciones: per_m  ? toNum(per_m[1])      : null,
    iva_rg:             iva_m  ? toNum(iva_m[1])      : null,
    importe_neto:       neto_m ? toNum(neto_m[1])     : null,
    pago_condiciones:   pago_m ? toNum(pago_m[1])     : null,
  };
};

const parseCTGs = (text) => {
  const ctgs = [];
  const re = /(\d{12})\s*(FG|G[123])\s*(\d+)\s*Localidad:\s*([^\n]+?)\s*(\d{2}\.\d{2})\s*(\d{4,6})\s*\n/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    ctgs.push({
      nro_comprobante:    m[1],
      grado:              m[2],
      contenido_proteico: parseFloat(m[3]),
      procedencia:        clean(m[4]),
      factor:             parseFloat(m[5]),
      peso_kg:            parseFloat(m[6]),
    });
  }
  return ctgs;
};

const parseCTGsPag2 = (text) => {
  const ctgs = [];
  const re = /CTG\.\s*Nro:\s*([\s\S]+?)(?=\n\n|\nFirma)/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const pares = [...m[1].matchAll(/(\d{11,14})\s*\(([\d.,]+)\)/g)];
    for (const p of pares) {
      ctgs.push({
        nro_comprobante: p[1],
        peso_kg: toNum(p[2]),
        grado: null, factor: null, contenido_proteico: null, procedencia: null,
      });
    }
  }
  return ctgs;
};

const parseDatosAdicionales = (text) => {
  const da_m = text.match(/Datos Adicionales:\s*([\s\S]+?)(?:Firma Comprador|$)/i);
  if (!da_m) return {};
  const da = da_m[1];
  const numDA = (s) => {
    if (!s) return null;
    return parseFloat(s.replace(/\./g,'').replace(',','.')) || null;
  };
  const exDA = (pattern) => {
    const m2 = da.match(pattern);
    return m2 ? numDA(m2[1]) : null;
  };
  const dc_m = da.match(/Desc\.Comercial:\s*[-]?\n([\d.,]+)/i)
            || da.match(/Desc\.Comercial:\s*([-\d.,]+)/i);
  return {
    contrato:            extractStr(da, /Contrato:\s*(\d+)/i),
    precio_base_tn:      exDA(/Precio:\s*([\d.,]+)\$\/TN/i),
    descuento_grado:     exDA(/Grado:\s*(-?[\d.,]+)/i),
    descuento_factor:    exDA(/Factor:\s*(-?[\d.,]+)/i),
    descuento_comercial: dc_m ? (da.includes('Desc.Comercial: -') ? -Math.abs(numDA(dc_m[1])) : numDA(dc_m[1])) : null,
    flete_neto:          exDA(/Flete:\s*(-?[\d.,]+)/i),
    precio_neto_tn:      exDA(/Px Neto:\s*([\d.,]+)/i),
  };
};

const parseLiquidacion = async (buffer) => {
  const data = await pdfParseBuffer(buffer);
  const text = data.text;
  const encabezado        = parseEncabezado(text);
  const partes            = parsePartes(text);
  const condiciones       = parseCondiciones(text);
  const operacion         = parseOperacion(text);
  const ctgs              = parseCTGs(text).length > 0 ? parseCTGs(text) : parseCTGsPag2(text);
  const datos_adicionales = parseDatosAdicionales(text);
  return { ...encabezado, ...partes, ...condiciones, ...operacion, ctgs, datos_adicionales };
};

module.exports = { parseLiquidacion };
