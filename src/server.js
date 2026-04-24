const express = require('express');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const session = require('express-session');
const nodemailer = require('nodemailer');
const PDFDocument = require('pdfkit');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const app = express();

const ROOT_DIR = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const PDF_DIR = path.join(DATA_DIR, 'pdf');
const QUOTES_FILE = path.join(DATA_DIR, 'quotes.json');
const CATALOG_FILE = path.join(DATA_DIR, 'catalog.json');
const LOGO_PATH = path.join(PUBLIC_DIR, 'logo.png');

const PORT = Number(process.env.PORT || 3000);
const SESSION_SECRET = process.env.SESSION_SECRET || 'cambia-questo-session-secret';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

const COMPANY_NAME = process.env.COMPANY_NAME || 'Quote Engine';
const COMPANY_EMAIL = process.env.COMPANY_EMAIL || process.env.GMAIL_USER || 'noreply@example.com';
const COMPANY_PHONE = process.env.COMPANY_PHONE || '';
const COMPANY_ADDRESS = process.env.COMPANY_ADDRESS || '';
const EMAIL_ENABLED = String(process.env.EMAIL_ENABLED || 'true').toLowerCase() !== 'false';

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function ensureFile(filePath, defaultValue) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2), 'utf8');
  }
}

ensureDir(DATA_DIR);
ensureDir(PDF_DIR);
ensureFile(QUOTES_FILE, []);
ensureFile(CATALOG_FILE, []);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      maxAge: 1000 * 60 * 60 * 8,
    },
  })
);

app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

app.use(express.static(PUBLIC_DIR));

function safeJsonParse(raw, fallback) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function readJsonArray(filePath) {
  try {
    const raw = await fsp.readFile(filePath, 'utf8');
    const parsed = safeJsonParse(raw, []);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeJson(filePath, data) {
  await fsp.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function slugify(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'item';
}

function toNumber(value, fallback = 0) {
  if (value === null || value === undefined) return fallback;
  const normalized = String(value).trim().replace(',', '.');
  if (normalized === '') return fallback;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : fallback;
}

function roundMoney(value) {
  return Math.round(toNumber(value) * 100) / 100;
}

function eur(value) {
  return new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency: 'EUR',
  }).format(toNumber(value));
}

function formatDate(dateLike = new Date()) {
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.NumberFormat('it-IT', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(toNumber(value));
}

function formatDate(dateLike = new Date()) {
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('it-IT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getStatusLabel(status) {
  const normalized = String(status || '').trim().toLowerCase();

  if (['accettato', 'accepted', 'approve', 'approved'].includes(normalized)) return 'Accettato';
  if (['rifiutato', 'rejected', 'reject', 'declined'].includes(normalized)) return 'Rifiutato';
  if (['inviato', 'sent', 'emailed'].includes(normalized)) return 'Inviato';
  if (['completato', 'completed', 'done', 'closed'].includes(normalized)) return 'Completato';
  if (['in attesa', 'attesa', 'pending', 'new', 'open', 'in-attesa'].includes(normalized)) return 'In attesa';

  return 'In attesa';
}

function normalizeCatalogItem(item = {}) {
  return {
    id: item.id || `prod_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: String(item.name || item.nome || 'Prodotto').trim(),
    description: String(item.description || item.descrizione || '').trim(),
    price: roundMoney(item.price ?? item.prezzo),
    sku: String(item.sku || item.codice || '').trim(),
    createdAt: item.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function normalizeQuoteItem(item = {}) {
  const quantity = Math.max(
    1,
    toNumber(item.quantity ?? item.qty ?? item.quantita ?? item.qta, 1)
  );

  const rawUnitPrice =
    item.unitPrice ??
    item.price ??
    item.prezzo ??
    item.unit_price ??
    item.unitario ??
    item.importoUnitario;

  const rawTotal =
    item.total ??
    item.lineTotal ??
    item.subtotal ??
    item.importo ??
    item.totaleRiga;

  let unitPrice = roundMoney(rawUnitPrice);
  let total = roundMoney(rawTotal);

  if (unitPrice <= 0 && total > 0 && quantity > 0) {
    unitPrice = roundMoney(total / quantity);
  }

  if (total <= 0) {
    total = roundMoney(quantity * unitPrice);
  }

  return {
    id: item.id || `row_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: String(item.name || item.nome || 'Prodotto').trim(),
    description: String(item.description || item.descrizione || '').trim(),
    quantity,
    unitPrice,
    total,
  };
}

function generateQuoteNumber(quotes) {
  const year = new Date().getFullYear();
  const yearlyQuotes = quotes.filter((q) => String(q.number || '').startsWith(`PRE-${year}-`));
  const maxProgressive = yearlyQuotes.reduce((max, q) => {
    const parts = String(q.number || '').split('-');
    const progressive = Number(parts[2] || 0);
    return progressive > max ? progressive : max;
  }, 0);

  const next = maxProgressive + 1;
  return `PRE-${year}-${String(next).padStart(4, '0')}`;
}

function normalizeQuotePayload(payload = {}, quotes = []) {
  const items = Array.isArray(payload.items)
    ? payload.items.map(normalizeQuoteItem)
    : Array.isArray(payload.products)
      ? payload.products.map(normalizeQuoteItem)
      : Array.isArray(payload.lines)
        ? payload.lines.map(normalizeQuoteItem)
        : [];

  const subtotal = roundMoney(items.reduce((sum, item) => sum + item.total, 0));
  const discount = roundMoney(Math.max(0, toNumber(payload.discount, 0)));
  const taxRate = Math.max(0, toNumber(payload.taxRate ?? payload.iva, 22));
  const taxable = roundMoney(Math.max(0, subtotal - discount));
  const taxAmount = roundMoney(taxable * (taxRate / 100));
  const total = roundMoney(taxable + taxAmount);

  const customerFirstName =
    payload.customer?.firstName ||
    payload.firstName ||
    payload.nome ||
    payload.customer?.name ||
    '';

  const customerLastName =
    payload.customer?.lastName ||
    payload.lastName ||
    payload.cognome ||
    payload.customer?.surname ||
    '';

  return {
    id: payload.id || `quote_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    number: payload.number || generateQuoteNumber(quotes),
    customer: {
      firstName: String(customerFirstName || '').trim(),
      lastName: String(customerLastName || '').trim(),
      email: String(payload.customer?.email || payload.email || '').trim(),
      phone: String(payload.customer?.phone || payload.phone || payload.telefono || '').trim(),
      company: String(payload.customer?.company || payload.company || payload.azienda || '').trim(),
    },
    items,
    notes: String(payload.notes || payload.note || '').trim(),
    status: getStatusLabel(payload.status),
    subtotal,
    discount,
    taxRate,
    taxAmount,
    total,
    createdAt: payload.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    pdfFile: payload.pdfFile || '',
  };
}

async function getCatalog() {
  const items = await readJsonArray(CATALOG_FILE);
  return items.map(normalizeCatalogItem);
}

async function saveCatalog(items) {
  await writeJson(CATALOG_FILE, items);
}

async function getQuotes() {
  const rawQuotes = await readJsonArray(QUOTES_FILE);
  return rawQuotes.map((quote) => normalizeQuotePayload(quote, rawQuotes));
}

async function saveQuotes(quotes) {
  await writeJson(QUOTES_FILE, quotes);
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) {
    return next();
  }
  return res.status(401).json({ error: 'Non autorizzato' });
}

function createTransporter() {
  if (!EMAIL_ENABLED) {
    throw new Error('Invio email disattivato nel file .env');
  }

  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    throw new Error('Mancano GMAIL_USER o GMAIL_APP_PASSWORD nel file .env');
  }

  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });
}

async function buildQuotePdf(quote) {
  ensureDir(PDF_DIR);

  const filename = `${slugify(quote.number)}.pdf`;
  const fullPath = path.join(PDF_DIR, filename);

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 0,
      compress: true,
    });

    const stream = fs.createWriteStream(fullPath);
    doc.pipe(stream);

    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const margin = 38;
    const contentWidth = pageWidth - margin * 2;
    const footerY = pageHeight - 26;
    const bottomSafeY = pageHeight - 74;

    const colors = {
      white: '#ffffff',
      page: '#f5f8fc',
      navy: '#0b1730',
      navy2: '#122341',
      text: '#172338',
      textSoft: '#5f6f88',
      textMuted: '#8796ad',
      line: '#d8e1ec',
      lineSoft: '#e8eef5',
      card: '#ffffff',
      rowA: '#ffffff',
      rowB: '#f8fbff',
      accent: '#4fd1ff',
      accent2: '#7c9cff',
      totalBg: '#0f1d36',
      totalBorder: '#264a82',
      totalSoft: '#9cb7db',
      noteBg: '#fbfdff',
    };

    const items = Array.isArray(quote.items) ? quote.items : [];
    const fullName =
      `${quote.customer?.firstName || ''} ${quote.customer?.lastName || ''}`.trim() || 'Cliente';

    let y = 0;

    function drawBackground() {
      doc.save().rect(0, 0, pageWidth, pageHeight).fill(colors.page).restore();
      doc.save().fillColor(colors.accent).rect(0, 0, pageWidth, 5).fill().restore();
    }

    function drawFooter() {
      doc
        .save()
        .moveTo(margin, footerY - 10)
        .lineTo(pageWidth - margin, footerY - 10)
        .lineWidth(1)
        .strokeColor(colors.lineSoft)
        .stroke()
        .restore();

      doc
        .font('Helvetica')
        .fontSize(8.5)
        .fillColor(colors.textMuted)
        .text(
          `${COMPANY_NAME}${COMPANY_EMAIL ? ` • ${COMPANY_EMAIL}` : ''}${COMPANY_PHONE ? ` • ${COMPANY_PHONE}` : ''}`,
          margin,
          footerY,
          {
            width: contentWidth,
            align: 'center',
          }
        );
    }

    function panel(x, yPos, w, h, fill = colors.white, stroke = colors.line, radius = 16) {
      doc
        .save()
        .lineWidth(1)
        .fillColor(fill)
        .strokeColor(stroke)
        .roundedRect(x, yPos, w, h, radius)
        .fillAndStroke()
        .restore();
    }

    function fillBar(x, yPos, w, h, fill = colors.accent) {
      doc.save().fillColor(fill).roundedRect(x, yPos, w, h, 2).fill().restore();
    }

    function getStatusStyle(status) {
      const normalized = String(status || '').trim().toLowerCase();

      if (['accettato', 'accepted', 'approve', 'approved'].includes(normalized)) {
        return { bg: '#eafaf3', border: '#bbe8d0', text: '#11835a', label: 'ACCETTATO' };
      }
      if (['rifiutato', 'rejected', 'reject', 'declined'].includes(normalized)) {
        return { bg: '#fff1f4', border: '#f2c2cf', text: '#d25176', label: 'RIFIUTATO' };
      }
      if (['inviato', 'sent', 'emailed'].includes(normalized)) {
        return { bg: '#eef8ff', border: '#cce8fb', text: '#1978b6', label: 'INVIATO' };
      }

      return { bg: '#fff8e8', border: '#f3deb2', text: '#b57a1f', label: 'IN ATTESA' };
    }

    function drawHeader(firstPage = true) {
      const headerY = firstPage ? 24 : 18;
      const headerH = firstPage ? 146 : 66;

      panel(margin, headerY, contentWidth, headerH, colors.navy, '#20385d', 22);
      fillBar(margin, headerY, contentWidth, 4, colors.accent);

      if (firstPage) {
        const logoBoxX = margin + 18;
        const logoBoxY = headerY + 18;
        const logoBoxSize = 60;

        panel(logoBoxX, logoBoxY, logoBoxSize, logoBoxSize, colors.navy2, '#29456c', 18);

        if (fs.existsSync(LOGO_PATH)) {
          try {
            doc.image(LOGO_PATH, logoBoxX + 8, logoBoxY + 8, {
              fit: [logoBoxSize - 16, logoBoxSize - 16],
              align: 'center',
              valign: 'center',
            });
          } catch (err) {
            console.error('Errore caricamento logo PDF:', err.message);
          }
        }

        const textX = logoBoxX + logoBoxSize + 16;

        doc
          .font('Helvetica-Bold')
          .fontSize(9)
          .fillColor('#a5b8d6')
          .text('QUOTE ENGINE • PREVENTIVO PROFESSIONALE', textX, headerY + 22, {
            width: 300,
            align: 'left',
          });

        doc
          .font('Helvetica-Bold')
          .fontSize(28)
          .fillColor(colors.white)
          .text('Preventivo', textX, headerY + 44, {
            width: 250,
            align: 'left',
          });

        const status = getStatusStyle(quote.status);
        const rightX = pageWidth - margin - 200;

        panel(rightX, headerY + 18, 160, 28, status.bg, status.border, 999);
        doc
          .font('Helvetica-Bold')
          .fontSize(9.5)
          .fillColor(status.text)
          .text(status.label, rightX, headerY + 27, {
            width: 160,
            align: 'center',
          });

        panel(rightX, headerY + 56, 160, 58, colors.navy2, '#29456c', 16);

        doc
          .font('Helvetica-Bold')
          .fontSize(7.5)
          .fillColor('#9fb3d6')
          .text('NUMERO', rightX + 12, headerY + 66, { width: 60 });

        doc
          .font('Helvetica-Bold')
          .fontSize(10)
          .fillColor(colors.white)
          .text(String(quote.number || '-'), rightX + 12, headerY + 77, {
            width: 136,
          });

        doc
          .font('Helvetica-Bold')
          .fontSize(7.5)
          .fillColor('#9fb3d6')
          .text('DATA', rightX + 12, headerY + 94, { width: 60 });

        doc
          .font('Helvetica-Bold')
          .fontSize(8.6)
          .fillColor(colors.white)
          .text(formatDate(quote.createdAt) || '-', rightX + 12, headerY + 104, {
            width: 136,
          });
      } else {
        doc
          .font('Helvetica-Bold')
          .fontSize(16)
          .fillColor(colors.white)
          .text(`Preventivo ${quote.number || ''}`, margin + 18, headerY + 18, {
            width: 260,
            align: 'left',
          });

        doc
          .font('Helvetica')
          .fontSize(9.5)
          .fillColor('#c8d6eb')
          .text(`${formatDate(quote.createdAt)} • ${getStatusLabel(quote.status)}`, 0, headerY + 20, {
            width: pageWidth - margin - 18,
            align: 'right',
          });
      }

      return headerY + headerH + 18;
    }

    function drawInfoCard(x, yPos, w, title, lines) {
      const h = 118;

      panel(x, yPos, w, h, colors.white, colors.line, 18);
      fillBar(x, yPos, w, 4, colors.accent2);

      doc
        .font('Helvetica-Bold')
        .fontSize(8.5)
        .fillColor(colors.textMuted)
        .text(title.toUpperCase(), x + 16, yPos + 14, {
          width: w - 32,
        });

      let lineY = yPos + 34;

      lines.forEach((lineText, index) => {
        doc
          .font(index === 0 ? 'Helvetica-Bold' : 'Helvetica')
          .fontSize(index === 0 ? 13 : 10)
          .fillColor(index === 0 ? colors.text : colors.textSoft)
          .text(lineText, x + 16, lineY, {
            width: w - 32,
            align: 'left',
          });

        lineY += index === 0 ? 19 : 15;
      });

      return h;
    }

    function drawTableHeader(yPos) {
      panel(margin, yPos, contentWidth, 34, colors.navy, colors.navy, 12);

      doc.font('Helvetica-Bold').fontSize(9.3).fillColor(colors.white);

      doc.text('Prodotto / Descrizione', margin + 16, yPos + 12, {
        width: 248,
      });

      doc.text('Q.tà', margin + 286, yPos + 12, {
        width: 34,
        align: 'right',
      });

      doc.text('Prezzo unit.', margin + 344, yPos + 12, {
        width: 78,
        align: 'right',
      });

      doc.text('Totale', margin + 432, yPos + 12, {
        width: 82,
        align: 'right',
      });

      return yPos + 44;
    }

    function getRowHeight(item) {
      const name = String(item.name || 'Prodotto').trim();
      const description = String(item.description || '').trim();

      doc.font('Helvetica-Bold').fontSize(10.3);
      const nameHeight = doc.heightOfString(name, { width: 248 });

      let descriptionHeight = 0;
      if (description) {
        doc.font('Helvetica').fontSize(8.7);
        descriptionHeight = doc.heightOfString(description, { width: 248 });
      }

      return Math.max(44, 14 + nameHeight + (description ? 6 + descriptionHeight : 0) + 14);
    }

    function ensureSpace(neededHeight, repeatHeader = false) {
      if (y + neededHeight <= bottomSafeY) return;

      drawFooter();
      doc.addPage();
      drawBackground();
      y = drawHeader(false);

      if (repeatHeader) {
        y = drawTableHeader(y);
      }
    }

    function drawRow(item, index) {
      const rowH = getRowHeight(item);
      ensureSpace(rowH + 10, true);

      panel(
        margin,
        y,
        contentWidth,
        rowH,
        index % 2 === 0 ? colors.rowA : colors.rowB,
        colors.lineSoft,
        14
      );

      const name = String(item.name || 'Prodotto').trim();
      const description = String(item.description || '').trim();

      doc
        .font('Helvetica-Bold')
        .fontSize(10.3)
        .fillColor(colors.text)
        .text(name, margin + 16, y + 13, {
          width: 248,
          align: 'left',
        });

      let nextY =
        y +
        13 +
        doc.heightOfString(name, {
          width: 248,
          align: 'left',
        });

      if (description) {
        doc
          .font('Helvetica')
          .fontSize(8.7)
          .fillColor(colors.textSoft)
          .text(description, margin + 16, nextY + 4, {
            width: 248,
            align: 'left',
          });
      }

      doc
        .font('Helvetica')
        .fontSize(10)
        .fillColor(colors.text)
        .text(String(item.quantity || 1), margin + 286, y + 15, {
          width: 34,
          align: 'right',
        });

      doc.text(eur(item.unitPrice || 0), margin + 344, y + 15, {
        width: 78,
        align: 'right',
      });

      doc
        .font('Helvetica-Bold')
        .text(eur(item.total || 0), margin + 432, y + 15, {
          width: 82,
          align: 'right',
        });

      y += rowH + 10;
    }

    function drawSummary(yPos) {
      const leftW = 302;
      const gap = 16;
      const rightW = contentWidth - leftW - gap;
      const leftX = margin;
      const rightX = margin + leftW + gap;
      const hasDiscount = Number(quote.discount || 0) > 0;
      const h = hasDiscount ? 154 : 136;

      ensureSpace(h + 18, false);

      panel(leftX, yPos, leftW, h, colors.totalBg, colors.totalBorder, 22);
      fillBar(leftX, yPos, leftW, 4, colors.accent);

      doc
        .font('Helvetica-Bold')
        .fontSize(9)
        .fillColor(colors.totalSoft)
        .text('TOTALE FINALE PREVENTIVO', leftX + 20, yPos + 20, {
          width: leftW - 40,
        });

      doc
        .font('Helvetica-Bold')
        .fontSize(31)
        .fillColor(colors.white)
        .text(eur(quote.total || 0), leftX + 20, yPos + 48, {
          width: leftW - 40,
        });

      doc
        .font('Helvetica')
        .fontSize(9.8)
        .fillColor('#c8d6eb')
        .text(
          'Importo complessivo del preventivo, già comprensivo dei calcoli finali.',
          leftX + 20,
          yPos + 94,
          {
            width: leftW - 44,
            lineGap: 1,
          }
        );

      panel(rightX, yPos, rightW, h, colors.white, colors.line, 22);
      fillBar(rightX, yPos, rightW, 4, colors.accent2);

      let sy = yPos + 20;
      const labelX = rightX + 20;
      const valueX = rightX + rightW - 148;
      const valueW = 128;

      doc
        .font('Helvetica-Bold')
        .fontSize(9)
        .fillColor(colors.textMuted)
        .text('RIEPILOGO ECONOMICO', labelX, sy, {
          width: rightW - 40,
        });

      sy += 26;

      doc.font('Helvetica').fontSize(10).fillColor(colors.textSoft);
      doc.text('Subtotale', labelX, sy, { width: 110 });
      doc.text(eur(quote.subtotal || 0), valueX, sy, { width: valueW, align: 'right' });
      sy += 19;

      if (hasDiscount) {
        doc.text('Sconto', labelX, sy, { width: 110 });
        doc.text(`- ${eur(quote.discount || 0)}`, valueX, sy, { width: valueW, align: 'right' });
        sy += 19;
      }

      doc.text(`IVA (${quote.taxRate || 0}%)`, labelX, sy, { width: 110 });
      doc.text(eur(quote.taxAmount || 0), valueX, sy, { width: valueW, align: 'right' });
      sy += 23;

      doc
        .save()
        .moveTo(labelX, sy - 6)
        .lineTo(rightX + rightW - 20, sy - 6)
        .lineWidth(1)
        .strokeColor(colors.line)
        .stroke()
        .restore();

      doc
        .font('Helvetica-Bold')
        .fontSize(11)
        .fillColor(colors.text)
        .text('Totale', labelX, sy + 4, {
          width: 90,
        });

      doc
        .font('Helvetica-Bold')
        .fontSize(18)
        .fillColor(colors.navy)
        .text(eur(quote.total || 0), rightX + rightW - 160, sy, {
          width: 140,
          align: 'right',
        });

      return h;
    }

    function drawNotes(yPos) {
      const notes = String(quote.notes || '').trim();
      if (!notes) return 0;

      doc.font('Helvetica').fontSize(10);
      const textHeight = doc.heightOfString(notes, {
        width: contentWidth - 32,
      });

      const h = Math.max(88, textHeight + 44);
      ensureSpace(h + 18, false);

      panel(margin, yPos, contentWidth, h, colors.noteBg, colors.line, 18);
      fillBar(margin, yPos, contentWidth, 4, colors.accent2);

      doc
        .font('Helvetica-Bold')
        .fontSize(9)
        .fillColor(colors.textMuted)
        .text('NOTE FINALI', margin + 16, yPos + 14, {
          width: contentWidth - 32,
        });

      doc
        .font('Helvetica')
        .fontSize(10)
        .fillColor(colors.text)
        .text(notes, margin + 16, yPos + 36, {
          width: contentWidth - 32,
          lineGap: 1,
        });

      return h;
    }

    drawBackground();
    y = drawHeader(true);

    const infoGap = 16;
    const infoW = (contentWidth - infoGap) / 2;
    const infoH = drawInfoCard(
      margin,
      y,
      infoW,
      'Da',
      [
        COMPANY_NAME,
        COMPANY_ADDRESS || '',
        COMPANY_PHONE ? `Tel: ${COMPANY_PHONE}` : '',
        COMPANY_EMAIL ? `Email: ${COMPANY_EMAIL}` : '',
      ].filter(Boolean)
    );

    drawInfoCard(
      margin + infoW + infoGap,
      y,
      infoW,
      'Cliente',
      [
        fullName,
        quote.customer?.company || '',
        quote.customer?.phone ? `Tel: ${quote.customer.phone}` : '',
        quote.customer?.email ? `Email: ${quote.customer.email}` : '',
      ].filter(Boolean)
    );

    y += infoH + 22;
    y = drawTableHeader(y);

    if (!items.length) {
      ensureSpace(58, true);

      panel(margin, y, contentWidth, 46, colors.rowA, colors.lineSoft, 14);

      doc
        .font('Helvetica')
        .fontSize(10)
        .fillColor(colors.textSoft)
        .text('Nessun prodotto inserito nel preventivo.', margin + 16, y + 16, {
          width: contentWidth - 32,
        });

      y += 58;
    } else {
      items.forEach((item, index) => drawRow(item, index));
    }

    const summaryH = drawSummary(y);
    y += summaryH + 18;

    if (quote.notes) {
      const notesH = drawNotes(y);
      y += notesH + 16;
    }

    const finalTextY = Math.min(y, pageHeight - 98);

    doc
      .font('Helvetica')
      .fontSize(8.8)
      .fillColor(colors.textMuted)
      .text(
        'Documento generato automaticamente da Quote Engine. Per informazioni, modifiche o personalizzazioni puoi contattare i riferimenti aziendali indicati in questo documento.',
        margin,
        finalTextY,
        {
          width: contentWidth - 20,
          align: 'left',
          lineGap: 1,
        }
      );

    drawFooter();

    doc.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });

  return {
    filename,
    fullPath,
    relativePath: `/api/quotes/${quote.id}/pdf`,
  };
}

function buildQuoteEmailHtml(quote) {
  const fullName = `${quote.customer.firstName || ''} ${quote.customer.lastName || ''}`.trim() || 'Cliente';
  const company = quote.customer.company
    ? `<div style="margin-top:4px;color:#555;">${escapeHtml(quote.customer.company)}</div>`
    : '';

  const phone = quote.customer.phone
    ? `<div style="margin-top:4px;color:#555;">Telefono: ${escapeHtml(quote.customer.phone)}</div>`
    : '';

  const notesBlock = quote.notes
    ? `
      <div style="margin-top:20px;padding:14px 16px;border:1px solid #e5e7eb;border-radius:12px;background:#fafafa;">
        <div style="font-size:13px;font-weight:700;margin-bottom:8px;">Note</div>
        <div style="font-size:14px;color:#333;">${escapeHtml(quote.notes)}</div>
      </div>
    `
    : '';

  const rows = (Array.isArray(quote.items) ? quote.items : [])
    .map((item) => {
      return `
        <tr>
          <td style="padding:10px 12px;border:1px solid #e5e7eb;text-align:left;">${escapeHtml(item.name)}</td>
          <td style="padding:10px 12px;border:1px solid #e5e7eb;text-align:right;">${escapeHtml(item.quantity)}</td>
          <td style="padding:10px 12px;border:1px solid #e5e7eb;text-align:right;">${escapeHtml(eur(item.unitPrice))}</td>
          <td style="padding:10px 12px;border:1px solid #e5e7eb;text-align:right;">${escapeHtml(eur(item.total))}</td>
        </tr>
      `;
    })
    .join('');

  const discountRow = quote.discount > 0
    ? `
      <tr>
        <td colspan="3" style="padding:8px 0;text-align:right;color:#555;">Sconto</td>
        <td style="padding:8px 0;text-align:right;color:#111;">- ${escapeHtml(eur(quote.discount))}</td>
      </tr>
    `
    : '';

  return `
    <div style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#111;">
      <div style="max-width:760px;margin:0 auto;padding:28px 16px;">
        <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:18px;overflow:hidden;box-shadow:0 10px 30px rgba(0,0,0,0.05);">
          <div style="padding:28px 28px 18px 28px;border-bottom:1px solid #ececec;background:#fcfcfc;">
            <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#666;margin-bottom:10px;">${escapeHtml(COMPANY_NAME)}</div>
            <h1 style="margin:0;font-size:26px;line-height:1.2;">Preventivo ${escapeHtml(quote.number)}</h1>
            <div style="margin-top:8px;font-size:14px;color:#555;">Data: ${escapeHtml(formatDate(quote.createdAt))}</div>
          </div>

          <div style="padding:28px;">
            <p style="margin:0 0 12px 0;font-size:15px;">Ciao <strong>${escapeHtml(fullName)}</strong>,</p>
            <p style="margin:0 0 18px 0;font-size:15px;color:#333;">
              ti inviamo in allegato il preventivo richiesto, con un riepilogo rapido qui sotto.
            </p>

            <div style="padding:16px 18px;border:1px solid #e5e7eb;border-radius:14px;background:#fafafa;margin-bottom:22px;">
              <div style="font-size:13px;font-weight:700;margin-bottom:8px;">Dati cliente</div>
              <div style="font-size:14px;color:#111;">${escapeHtml(fullName)}</div>
              ${company}
              <div style="margin-top:4px;color:#555;">Email: ${escapeHtml(quote.customer.email || '-')}</div>
              ${phone}
            </div>

            <table style="border-collapse:collapse;width:100%;margin:0 0 22px 0;font-size:14px;">
              <thead>
                <tr>
                  <th style="padding:10px 12px;border:1px solid #e5e7eb;text-align:left;background:#f9fafb;">Prodotto</th>
                  <th style="padding:10px 12px;border:1px solid #e5e7eb;text-align:right;background:#f9fafb;">Q.tà</th>
                  <th style="padding:10px 12px;border:1px solid #e5e7eb;text-align:right;background:#f9fafb;">Prezzo</th>
                  <th style="padding:10px 12px;border:1px solid #e5e7eb;text-align:right;background:#f9fafb;">Totale</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>

            <div style="display:flex;justify-content:flex-end;">
              <div style="width:100%;max-width:320px;">
                <table style="width:100%;border-collapse:collapse;font-size:14px;">
                  <tr>
                    <td style="padding:8px 0;text-align:right;color:#555;">Subtotale</td>
                    <td style="padding:8px 0;text-align:right;color:#111;">${escapeHtml(eur(quote.subtotal))}</td>
                  </tr>
                  ${discountRow}
                  <tr>
                    <td style="padding:8px 0;text-align:right;color:#555;">IVA (${escapeHtml(quote.taxRate)}%)</td>
                    <td style="padding:8px 0;text-align:right;color:#111;">${escapeHtml(eur(quote.taxAmount))}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0 0 0;text-align:right;font-size:16px;font-weight:700;">Totale</td>
                    <td style="padding:12px 0 0 0;text-align:right;font-size:18px;font-weight:700;">${escapeHtml(eur(quote.total))}</td>
                  </tr>
                </table>
              </div>
            </div>

            ${notesBlock}

            <div style="margin-top:24px;padding-top:18px;border-top:1px solid #ececec;">
              <p style="margin:0 0 10px 0;font-size:14px;color:#333;">
                Per qualsiasi informazione o modifica, puoi rispondere direttamente a questa email.
              </p>
              <p style="margin:0;font-size:14px;color:#333;">
                Grazie,<br>
                <strong>${escapeHtml(COMPANY_NAME)}</strong><br>
                ${COMPANY_EMAIL ? `<span style="color:#555;">${escapeHtml(COMPANY_EMAIL)}</span><br>` : ''}
                ${COMPANY_PHONE ? `<span style="color:#555;">${escapeHtml(COMPANY_PHONE)}</span>` : ''}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function buildQuoteEmailText(quote) {
  const fullName = `${quote.customer.firstName || ''} ${quote.customer.lastName || ''}`.trim() || 'Cliente';

  return [
    `Ciao ${fullName},`,
    '',
    `in allegato trovi il preventivo ${quote.number}.`,
    `Totale: ${eur(quote.total)}`,
    '',
    'Per qualsiasi dubbio puoi rispondere a questa email.',
    '',
    COMPANY_NAME,
  ].join('\n');
}

async function sendQuoteEmail(quote) {
  const customerEmail = String(quote?.customer?.email || '').trim();

  if (!customerEmail) {
    throw new Error('Il preventivo non ha una email cliente');
  }

  const transporter = createTransporter();

  try {
    await transporter.verify();
  } catch (error) {
    console.error('Errore verify SMTP:', error);
    throw new Error('Connessione SMTP fallita. Controlla GMAIL_USER e GMAIL_APP_PASSWORD');
  }

  let pdfPath = '';
  if (quote?.pdfFile) {
    pdfPath = path.join(PDF_DIR, quote.pdfFile);
  }

  if (!pdfPath || !fs.existsSync(pdfPath)) {
    const pdfInfo = await buildQuotePdf(quote);
    pdfPath = pdfInfo.fullPath;
    quote.pdfFile = pdfInfo.filename;
  }

  if (!pdfPath || !fs.existsSync(pdfPath)) {
    throw new Error('PDF del preventivo non trovato');
  }

  console.log('=== INVIO EMAIL PREVENTIVO ===');
  console.log('MITTENTE:', process.env.GMAIL_USER);
  console.log('DESTINATARIO REALE:', JSON.stringify(customerEmail));
  console.log('OGGETTO:', `Preventivo ${quote.number}`);
  console.log('PDF PATH:', pdfPath);
  console.log('PDF ESISTE:', fs.existsSync(pdfPath));

  const info = await transporter.sendMail({
    from: `"${COMPANY_NAME}" <${process.env.GMAIL_USER}>`,
    replyTo: COMPANY_EMAIL || process.env.GMAIL_USER,
    to: customerEmail,
    subject: `Preventivo ${quote.number}`,
    text: buildQuoteEmailText(quote),
    html: buildQuoteEmailHtml(quote),
    attachments: [
      {
        filename: quote.pdfFile || `${slugify(quote.number)}.pdf`,
        path: pdfPath,
      },
    ],
  });

  console.log('=== RISULTATO SENDMAIL ===');
  console.log('ENVELOPE:', info.envelope);
  console.log('ACCEPTED:', info.accepted);
  console.log('REJECTED:', info.rejected);
  console.log('RESPONSE:', info.response);
  console.log('MESSAGE ID:', info.messageId);

  if (Array.isArray(info.rejected) && info.rejected.length > 0) {
    throw new Error(`Destinatario rifiutato dal server SMTP: ${info.rejected.join(', ')}`);
  }

  return info;
}

async function sendTestEmail(targetEmail) {
  const email = String(targetEmail || '').trim();

  if (!email) {
    throw new Error('Email destinatario mancante');
  }

  const transporter = createTransporter();

  try {
    await transporter.verify();
  } catch (error) {
    console.error('Errore verify SMTP test:', error);
    throw new Error('Connessione SMTP fallita. Controlla GMAIL_USER e GMAIL_APP_PASSWORD');
  }

  console.log('=== INVIO TEST EMAIL ===');
  console.log('MITTENTE:', process.env.GMAIL_USER);
  console.log('DESTINATARIO TEST:', JSON.stringify(email));

  const info = await transporter.sendMail({
    from: `"${COMPANY_NAME}" <${process.env.GMAIL_USER}>`,
    replyTo: COMPANY_EMAIL || process.env.GMAIL_USER,
    to: email,
    subject: `Test email ${COMPANY_NAME}`,
    text: 'Questa è una email di test inviata correttamente dal server.',
    html: `
      <div style="font-family:Arial,Helvetica,sans-serif;padding:20px;color:#111;">
        <h2 style="margin-top:0;">Test email Quote Engine</h2>
        <p>Questa è una email di test inviata correttamente dal server.</p>
      </div>
    `,
  });

  console.log('=== RISULTATO TEST EMAIL ===');
  console.log('ENVELOPE:', info.envelope);
  console.log('ACCEPTED:', info.accepted);
  console.log('REJECTED:', info.rejected);
  console.log('RESPONSE:', info.response);
  console.log('MESSAGE ID:', info.messageId);

  return info;
}

/* AUTH */

app.post('/api/admin/login', (req, res) => {
  const password = String(req.body?.password || '');

  if (!password) {
    return res.status(400).json({ error: 'Password mancante' });
  }

  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Password non valida' });
  }

  req.session.isAdmin = true;
  return res.json({ ok: true, isAdmin: true });
});

app.post('/api/admin/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.get('/api/admin/me', (req, res) => {
  return res.json({ isAdmin: !!req.session?.isAdmin });
});

app.get('/api/admin/check', (req, res) => {
  return res.json({ isAdmin: !!req.session?.isAdmin });
});

/* PAGINE */

app.get('/admin', (req, res) => {
  const adminPath = path.join(PUBLIC_DIR, 'admin.html');
  if (!fs.existsSync(adminPath)) {
    return res.status(404).send('admin.html non trovato');
  }
  return res.sendFile(adminPath);
});

app.get('/widget', (req, res) => {
  const widgetPath = path.join(PUBLIC_DIR, 'widget.html');
  if (!fs.existsSync(widgetPath)) {
    return res.status(404).send('widget.html non trovato');
  }
  return res.sendFile(widgetPath);
});

app.get('/', (req, res, next) => {
  const indexPath = path.join(PUBLIC_DIR, 'index.html');
  if (fs.existsSync(indexPath)) {
    return res.sendFile(indexPath);
  }
  return next();
});

/* HEALTH */

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    app: 'Quote Engine',
    emailEnabled: EMAIL_ENABLED,
    hasGmailUser: !!process.env.GMAIL_USER,
    hasGmailPassword: !!process.env.GMAIL_APP_PASSWORD,
  });
});

/* TEST EMAIL */

app.post('/api/admin/test-email', requireAdmin, async (req, res) => {
  try {
    const email = req.body?.email;
    const info = await sendTestEmail(email);
    return res.json({
      ok: true,
      accepted: info.accepted || [],
      rejected: info.rejected || [],
      response: info.response || '',
      messageId: info.messageId || '',
    });
  } catch (error) {
    console.error('Errore test email:', error);
    return res.status(500).json({ error: error.message || 'Errore test email' });
  }
});

/* CATALOGO */

app.get('/api/catalog', async (_req, res) => {
  try {
    const catalog = await getCatalog();
    return res.json(catalog);
  } catch (error) {
    console.error('Errore lettura catalogo:', error);
    return res.status(500).json({ error: 'Errore lettura catalogo' });
  }
});

app.get('/api/admin/catalog', requireAdmin, async (_req, res) => {
  try {
    const catalog = await getCatalog();
    return res.json(catalog);
  } catch (error) {
    console.error('Errore lettura catalogo admin:', error);
    return res.status(500).json({ error: 'Errore lettura catalogo' });
  }
});

app.post('/api/catalog', requireAdmin, async (req, res) => {
  try {
    const catalog = await getCatalog();
    const item = normalizeCatalogItem(req.body);
    catalog.unshift(item);
    await saveCatalog(catalog);
    return res.json({ ok: true, item });
  } catch (error) {
    console.error('Errore creazione prodotto:', error);
    return res.status(500).json({ error: 'Errore creazione prodotto' });
  }
});

app.post('/api/admin/catalog', requireAdmin, async (req, res) => {
  try {
    const catalog = await getCatalog();
    const item = normalizeCatalogItem(req.body);
    catalog.unshift(item);
    await saveCatalog(catalog);
    return res.json({ ok: true, item });
  } catch (error) {
    console.error('Errore creazione prodotto admin:', error);
    return res.status(500).json({ error: 'Errore creazione prodotto' });
  }
});

async function updateCatalogItemHandler(req, res) {
  try {
    const catalog = await getCatalog();
    const index = catalog.findIndex((item) => item.id === req.params.id);

    if (index === -1) {
      return res.status(404).json({ error: 'Prodotto non trovato' });
    }

    const updated = normalizeCatalogItem({
      ...catalog[index],
      ...req.body,
      id: catalog[index].id,
      createdAt: catalog[index].createdAt,
      updatedAt: new Date().toISOString(),
    });

    catalog[index] = updated;
    await saveCatalog(catalog);

    return res.json({ ok: true, item: updated });
  } catch (error) {
    console.error('Errore aggiornamento prodotto:', error);
    return res.status(500).json({ error: 'Errore aggiornamento prodotto' });
  }
}

app.put('/api/catalog/:id', requireAdmin, updateCatalogItemHandler);
app.patch('/api/catalog/:id', requireAdmin, updateCatalogItemHandler);
app.put('/api/admin/catalog/:id', requireAdmin, updateCatalogItemHandler);
app.patch('/api/admin/catalog/:id', requireAdmin, updateCatalogItemHandler);

async function deleteCatalogItemHandler(req, res) {
  try {
    const catalog = await getCatalog();
    const filtered = catalog.filter((item) => item.id !== req.params.id);

    if (filtered.length === catalog.length) {
      return res.status(404).json({ error: 'Prodotto non trovato' });
    }

    await saveCatalog(filtered);
    return res.json({ ok: true });
  } catch (error) {
    console.error('Errore eliminazione prodotto:', error);
    return res.status(500).json({ error: 'Errore eliminazione prodotto' });
  }
}

app.delete('/api/catalog/:id', requireAdmin, deleteCatalogItemHandler);
app.delete('/api/admin/catalog/:id', requireAdmin, deleteCatalogItemHandler);

/* PREVENTIVI */

app.get('/api/quotes', requireAdmin, async (req, res) => {
  try {
    const quotes = await getQuotes();
    const q = String(req.query.q || '').trim().toLowerCase();
    const statusFilter = String(req.query.status || '').trim().toLowerCase();

    let filtered = [...quotes];

    if (q) {
      filtered = filtered.filter((quote) => {
        const customerName = `${quote.customer.firstName} ${quote.customer.lastName}`.trim().toLowerCase();
        const company = String(quote.customer.company || '').toLowerCase();
        const email = String(quote.customer.email || '').toLowerCase();
        const phone = String(quote.customer.phone || '').toLowerCase();
        const number = String(quote.number || '').toLowerCase();

        return (
          customerName.includes(q) ||
          company.includes(q) ||
          email.includes(q) ||
          phone.includes(q) ||
          number.includes(q)
        );
      });
    }

    if (statusFilter) {
      filtered = filtered.filter(
        (quote) => String(quote.status || '').trim().toLowerCase() === statusFilter
      );
    }

    filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return res.json(filtered);
  } catch (error) {
    console.error('Errore lettura preventivi:', error);
    return res.status(500).json({ error: 'Errore lettura preventivi' });
  }
});

app.get('/api/admin/quotes', requireAdmin, async (req, res) => {
  try {
    const quotes = await getQuotes();
    const q = String(req.query.q || '').trim().toLowerCase();
    const statusFilter = String(req.query.status || '').trim().toLowerCase();

    let filtered = [...quotes];

    if (q) {
      filtered = filtered.filter((quote) => {
        const customerName = `${quote.customer.firstName} ${quote.customer.lastName}`.trim().toLowerCase();
        const company = String(quote.customer.company || '').toLowerCase();
        const email = String(quote.customer.email || '').toLowerCase();
        const phone = String(quote.customer.phone || '').toLowerCase();
        const number = String(quote.number || '').toLowerCase();

        return (
          customerName.includes(q) ||
          company.includes(q) ||
          email.includes(q) ||
          phone.includes(q) ||
          number.includes(q)
        );
      });
    }

    if (statusFilter) {
      filtered = filtered.filter(
        (quote) => String(quote.status || '').trim().toLowerCase() === statusFilter
      );
    }

    filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return res.json(filtered);
  } catch (error) {
    console.error('Errore lettura preventivi admin:', error);
    return res.status(500).json({ error: 'Errore lettura preventivi' });
  }
});

app.get('/api/quotes/:id', requireAdmin, async (req, res) => {
  try {
    const quotes = await getQuotes();
    const quote = quotes.find((item) => item.id === req.params.id);

    if (!quote) {
      return res.status(404).json({ error: 'Preventivo non trovato' });
    }

    return res.json(quote);
  } catch (error) {
    console.error('Errore lettura preventivo:', error);
    return res.status(500).json({ error: 'Errore lettura preventivo' });
  }
});

app.get('/api/admin/quotes/:id', requireAdmin, async (req, res) => {
  try {
    const quotes = await getQuotes();
    const quote = quotes.find((item) => item.id === req.params.id);

    if (!quote) {
      return res.status(404).json({ error: 'Preventivo non trovato' });
    }

    return res.json(quote);
  } catch (error) {
    console.error('Errore lettura preventivo admin:', error);
    return res.status(500).json({ error: 'Errore lettura preventivo' });
  }
});

async function createQuoteHandler(req, res) {
  try {
    const quotes = await getQuotes();
    const quote = normalizeQuotePayload(req.body, quotes);

    const pdfInfo = await buildQuotePdf(quote);
    quote.pdfFile = pdfInfo.filename;

    quotes.unshift(quote);
    await saveQuotes(quotes);

    return res.json({ ok: true, quote });
  } catch (error) {
    console.error('Errore creazione preventivo:', error);
    return res.status(500).json({ error: 'Errore creazione preventivo' });
  }
}

app.post('/api/quotes', requireAdmin, createQuoteHandler);
app.post('/api/admin/quotes', requireAdmin, createQuoteHandler);

async function updateQuoteHandler(req, res) {
  try {
    const quotes = await getQuotes();
    const index = quotes.findIndex((quote) => quote.id === req.params.id);

    if (index === -1) {
      return res.status(404).json({ error: 'Preventivo non trovato' });
    }

    const existing = quotes[index];
    const mergedPayload = {
      ...existing,
      ...req.body,
      id: existing.id,
      number: existing.number,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
      pdfFile: existing.pdfFile,
    };

    const updatedQuote = normalizeQuotePayload(mergedPayload, quotes);
    const pdfInfo = await buildQuotePdf(updatedQuote);
    updatedQuote.pdfFile = pdfInfo.filename;

    quotes[index] = updatedQuote;
    await saveQuotes(quotes);

    return res.json({ ok: true, quote: updatedQuote });
  } catch (error) {
    console.error('Errore aggiornamento preventivo:', error);
    return res.status(500).json({ error: 'Errore aggiornamento preventivo' });
  }
}

app.put('/api/quotes/:id', requireAdmin, updateQuoteHandler);
app.patch('/api/quotes/:id', requireAdmin, updateQuoteHandler);
app.put('/api/admin/quotes/:id', requireAdmin, updateQuoteHandler);
app.patch('/api/admin/quotes/:id', requireAdmin, updateQuoteHandler);

async function updateQuoteStatus(req, res) {
  try {
    const quotes = await getQuotes();
    const index = quotes.findIndex((quote) => quote.id === req.params.id);

    if (index === -1) {
      return res.status(404).json({ error: 'Preventivo non trovato' });
    }

    const nextStatus = getStatusLabel(req.body?.status || req.body?.newStatus);
    quotes[index].status = nextStatus;
    quotes[index].updatedAt = new Date().toISOString();

    const pdfInfo = await buildQuotePdf(quotes[index]);
    quotes[index].pdfFile = pdfInfo.filename;

    await saveQuotes(quotes);

    return res.json({ ok: true, quote: quotes[index] });
  } catch (error) {
    console.error('Errore aggiornamento stato preventivo:', error);
    return res.status(500).json({ error: 'Errore aggiornamento stato preventivo' });
  }
}

app.put('/api/quotes/:id/status', requireAdmin, updateQuoteStatus);
app.patch('/api/quotes/:id/status', requireAdmin, updateQuoteStatus);
app.put('/api/admin/quotes/:id/status', requireAdmin, updateQuoteStatus);
app.patch('/api/admin/quotes/:id/status', requireAdmin, updateQuoteStatus);

async function deleteQuoteHandler(req, res) {
  try {
    const quotes = await getQuotes();
    const quote = quotes.find((item) => item.id === req.params.id);
    const filtered = quotes.filter((item) => item.id !== req.params.id);

    if (filtered.length === quotes.length) {
      return res.status(404).json({ error: 'Preventivo non trovato' });
    }

    if (quote?.pdfFile) {
      const pdfPath = path.join(PDF_DIR, quote.pdfFile);
      if (fs.existsSync(pdfPath)) {
        try {
          await fsp.unlink(pdfPath);
        } catch (err) {
          console.error('Errore eliminazione PDF:', err.message);
        }
      }
    }

    await saveQuotes(filtered);
    return res.json({ ok: true });
  } catch (error) {
    console.error('Errore eliminazione preventivo:', error);
    return res.status(500).json({ error: 'Errore eliminazione preventivo' });
  }
}

app.delete('/api/quotes/:id', requireAdmin, deleteQuoteHandler);
app.delete('/api/admin/quotes/:id', requireAdmin, deleteQuoteHandler);

app.get('/api/quotes/:id/pdf', async (req, res) => {
  try {
    const quotes = await getQuotes();
    const quote = quotes.find((item) => item.id === req.params.id);

    if (!quote) {
      return res.status(404).send('Preventivo non trovato');
    }

    let pdfPath = quote.pdfFile ? path.join(PDF_DIR, quote.pdfFile) : '';

    if (!pdfPath || !fs.existsSync(pdfPath)) {
      const pdfInfo = await buildQuotePdf(quote);
      quote.pdfFile = pdfInfo.filename;
      await saveQuotes(quotes);
      pdfPath = pdfInfo.fullPath;
    }

    return res.sendFile(pdfPath);
  } catch (error) {
    console.error('Errore apertura PDF:', error);
    return res.status(500).send('Errore apertura PDF');
  }
});

app.get('/api/admin/quotes/:id/pdf', requireAdmin, async (req, res) => {
  try {
    const quotes = await getQuotes();
    const quote = quotes.find((item) => item.id === req.params.id);

    if (!quote) {
      return res.status(404).send('Preventivo non trovato');
    }

    let pdfPath = quote.pdfFile ? path.join(PDF_DIR, quote.pdfFile) : '';

    if (!pdfPath || !fs.existsSync(pdfPath)) {
      const pdfInfo = await buildQuotePdf(quote);
      quote.pdfFile = pdfInfo.filename;
      await saveQuotes(quotes);
      pdfPath = pdfInfo.fullPath;
    }

    return res.sendFile(pdfPath);
  } catch (error) {
    console.error('Errore apertura PDF admin:', error);
    return res.status(500).send('Errore apertura PDF');
  }
});

async function handleSendQuoteEmail(req, res) {
  try {
    const quotes = await getQuotes();
    const index = quotes.findIndex((quote) => quote.id === req.params.id);

    if (index === -1) {
      return res.status(404).json({ error: 'Preventivo non trovato' });
    }

    const info = await sendQuoteEmail(quotes[index]);

    quotes[index].status = 'Inviato';
    quotes[index].updatedAt = new Date().toISOString();
    await saveQuotes(quotes);

    return res.json({
      ok: true,
      message: 'Email inviata con successo',
      accepted: info.accepted || [],
      rejected: info.rejected || [],
      response: info.response || '',
      messageId: info.messageId || '',
    });
  } catch (error) {
    console.error('Errore invio email:', error);
    return res.status(500).json({
      error: error.message || 'Errore durante l\'invio della email',
    });
  }
}

app.post('/api/quotes/:id/send-email', requireAdmin, handleSendQuoteEmail);
app.post('/api/quotes/:id/email', requireAdmin, handleSendQuoteEmail);
app.post('/api/quotes/:id/send', requireAdmin, handleSendQuoteEmail);

app.post('/api/admin/quotes/:id/send-email', requireAdmin, handleSendQuoteEmail);
app.post('/api/admin/quotes/:id/email', requireAdmin, handleSendQuoteEmail);
app.post('/api/admin/quotes/:id/send', requireAdmin, handleSendQuoteEmail);

/* 404 */

app.use((req, res) => {
  res.status(404).json({
    error: 'Endpoint non trovato',
    method: req.method,
    path: req.originalUrl,
  });
});

app.listen(PORT, () => {
  console.log(`Quote Engine attivo su http://localhost:${PORT}`);
});