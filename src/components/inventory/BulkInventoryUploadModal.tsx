import React, { useState, useRef, useMemo, useEffect } from 'react';
import { Product, Category, BulkImportItem, BulkImportMode, BulkImportResult } from '../../domain/catalog';
import { parseDecimalToCents, parseDecimalToBps } from '../../domain/money';
import { createCatalogReadApi } from '../../adapters/catalogApiFactory';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { Badge } from '../common/Badge';
import { SearchInput } from '../common/SearchInput';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import {
  downloadCsvFile,
  generateInventoryCsv,
  getBlankCsvTemplate,
} from '../../utils/csvExport';
import {
  UploadCloud,
  FileSpreadsheet,
  FileCode,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ArrowRight,
  ArrowLeft,
  Download,
  HelpCircle,
  Layers,
  Sparkles,
  RefreshCw,
  Sliders,
  Check,
  Package,
  Info,
  FileText,
  Trash2,
} from 'lucide-react';

interface BulkInventoryUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  existingProducts: readonly Product[];
  categories: readonly Category[];
  onImportComplete: (result: BulkImportResult) => void;
}

type Step = 'upload' | 'mapping' | 'preview' | 'result';

interface FieldDefinition {
  key: keyof BulkImportItem | 'category';
  label: string;
  labelTh: string;
  required: boolean;
  type: 'string' | 'number' | 'boolean';
  description: string;
  descriptionTh: string;
  aliases: string[];
}

const SYSTEM_FIELDS: FieldDefinition[] = [
  {
    key: 'sku',
    label: 'SKU / Item Code',
    labelTh: 'รหัสสินค้า (SKU)',
    required: true,
    type: 'string',
    description: 'Unique product identifier (e.g. BEV-LAT-01)',
    descriptionTh: 'รหัสสินค้าเอกลักษณ์ประจำรายการ',
    aliases: [
      'sku',
      'item_sku',
      'product_sku',
      'code',
      'item_code',
      'product_code',
      'item_id',
      'product_id',
      'id',
      'รหัสสินค้า',
      'รหัส',
      'รหัสแท่ง',
      'sku_code',
    ],
  },
  {
    key: 'name',
    label: 'Product Name',
    labelTh: 'ชื่อสินค้า',
    required: false,
    type: 'string',
    description: 'Display title for POS and receipts (Required for new items)',
    descriptionTh: 'ชื่อที่แสดงในระบบขายและใบเสร็จ (จำเป็นสำหรับสินค้าใหม่)',
    aliases: [
      'name',
      'product_name',
      'item_name',
      'title',
      'product_title',
      'description_name',
      'ชื่อสินค้า',
      'ชื่อ',
      'รายการ',
      'ชื่อรายการ',
      'สินค้า',
    ],
  },
  {
    key: 'barcode',
    label: 'Barcode / UPC / EAN',
    labelTh: 'บาร์โค้ด / UPC / EAN',
    required: false,
    type: 'string',
    description: 'Scannable 8-14 digit barcode string',
    descriptionTh: 'รหัสบาร์โค้ดสำหรับสแกนเนอร์',
    aliases: [
      'barcode',
      'upc',
      'ean',
      'isbn',
      'barcode_number',
      'gtin',
      'scan_code',
      'บาร์โค้ด',
      'รหัสบาร์โค้ด',
    ],
  },
  {
    key: 'priceAmountInCents',
    label: 'Retail Sale Price',
    labelTh: 'ราคาขายปลีก',
    required: false,
    type: 'number',
    description: 'Selling price per unit (e.g. 85.00 or 1500 in Baht)',
    descriptionTh: 'ราคาขายหน้าร้านต่อหน่วย',
    aliases: [
      'price',
      'retail_price',
      'sale_price',
      'unit_price',
      'selling_price',
      'price_thb',
      'price_usd',
      'msrp',
      'ราคา',
      'ราคาขาย',
      'ราคาปลีก',
      'ราคาต่อหน่วย',
      'ราคาหน้าร้าน',
    ],
  },
  {
    key: 'costPriceAmountInCents',
    label: 'Cost Price (COGS)',
    labelTh: 'ราคาทุนสินค้า',
    required: false,
    type: 'number',
    description: 'Purchase cost per unit for margin calculation',
    descriptionTh: 'ต้นทุนสินค้าต่อหน่วยเพื่อคำนวณกำไร',
    aliases: [
      'cost',
      'cost_price',
      'unit_cost',
      'cogs',
      'supply_price',
      'buy_price',
      'purchase_cost',
      'ราคาทุน',
      'ต้นทุน',
      'ทุน',
      'ราคาต้นทุน',
    ],
  },
  {
    key: 'currentStock',
    label: 'Stock Quantity',
    labelTh: 'จำนวนสต็อกคงเหลือ',
    required: false,
    type: 'number',
    description: 'Current physical inventory count or quantity on hand',
    descriptionTh: 'จำนวนสินค้าที่มีอยู่ในคลัง',
    aliases: [
      'stock',
      'current_stock',
      'quantity',
      'qty',
      'on_hand',
      'stock_on_hand',
      'inventory',
      'balance',
      'สต็อก',
      'จำนวน',
      'คงเหลือ',
      'สต็อกคงเหลือ',
      'จำนวนคงเหลือ',
      'ยอดนับ',
    ],
  },
  {
    key: 'reorderPoint',
    label: 'Reorder Alert Point',
    labelTh: 'จุดเตือนสั่งซื้อขั้นต่ำ',
    required: false,
    type: 'number',
    description: 'Low-stock alert threshold (default: 10)',
    descriptionTh: 'เกณฑ์แจ้งเตือนสต็อกต่ำ',
    aliases: [
      'reorder_point',
      'reorder',
      'min_stock',
      'safety_stock',
      'alert_threshold',
      'threshold',
      'low_stock_level',
      'จุดสั่งซื้อ',
      'จุดเตือน',
      'สต็อกขั้นต่ำ',
      'เกณฑ์เตือน',
    ],
  },
  {
    key: 'category',
    label: 'Category Name or ID',
    labelTh: 'หมวดหมู่สินค้า',
    required: false,
    type: 'string',
    description: 'Category name or ID (e.g. cat-coffee or Beverages)',
    descriptionTh: 'ชื่อหรือรหัสหมวดหมู่สินค้า',
    aliases: [
      'category',
      'category_id',
      'category_name',
      'cat',
      'dept',
      'department',
      'group',
      'collection',
      'หมวดหมู่',
      'หมวด',
      'กลุ่มสินค้า',
      'ประเภท',
    ],
  },
  {
    key: 'unitOfMeasure',
    label: 'Unit of Measure',
    labelTh: 'หน่วยนับ',
    required: false,
    type: 'string',
    description: 'e.g. cup, piece, bottle, pack, box, kg',
    descriptionTh: 'เช่น แก้ว, ชิ้น, ขวด, กล่อง, แพ็ก',
    aliases: [
      'unit',
      'unit_of_measure',
      'uom',
      'measure_unit',
      'unit_name',
      'type',
      'หน่วย',
      'หน่วยนับ',
    ],
  },
  {
    key: 'taxRateBps',
    label: 'VAT / Tax Rate (%)',
    labelTh: 'อัตราภาษีมูลค่าเพิ่ม (%)',
    required: false,
    type: 'number',
    description: 'Tax rate percentage or bps (e.g. 7 for 7% VAT or 700 bps)',
    descriptionTh: 'อัตราภาษี เช่น 7 สำหรับ VAT 7% หรือ 700 bps',
    aliases: [
      'tax',
      'tax_rate',
      'vat',
      'tax_percentage',
      'tax_bps',
      'vat_rate',
      'ภาษี',
      'อัตราภาษี',
      'vat_percent',
    ],
  },
  {
    key: 'description',
    label: 'Description / Notes',
    labelTh: 'รายละเอียดสินค้า',
    required: false,
    type: 'string',
    description: 'Brief product description or supplier notes',
    descriptionTh: 'คำอธิบายสินค้าเพิ่มเติม',
    aliases: [
      'description',
      'desc',
      'details',
      'notes',
      'summary',
      'product_description',
      'รายละเอียด',
      'คำอธิบาย',
      'หมายเหตุ',
    ],
  },
];

interface ValidatedRow {
  rowNumber: number;
  raw: Record<string, any>;
  parsed: BulkImportItem;
  status: 'valid_new' | 'valid_update' | 'warning' | 'error';
  isExisting: boolean;
  existingProduct?: Product;
  errors: string[];
  warnings: string[];
}

export const BulkInventoryUploadModal: React.FC<BulkInventoryUploadModalProps> = ({
  isOpen,
  onClose,
  existingProducts,
  categories,
  onImportComplete,
}) => {
  const { language } = useLanguage();
  const { session, can } = useAuth();
  const { addToast } = useToast();
  const catalogApi = useMemo(() => createCatalogReadApi(session?.token ?? ''), [session?.token]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Wizard state
  const [currentStep, setCurrentStep] = useState<Step>('upload');
  const [uploadMode, setUploadMode] = useState<'file' | 'paste'>('file');
  const [rawPastedText, setRawPastedText] = useState('');
  const [fileName, setFileName] = useState('');
  const [fileSize, setFileSize] = useState<number | null>(null);

  // Parsed raw dataset
  const [parsedHeaders, setParsedHeaders] = useState<string[]>([]);
  const [parsedRawRows, setParsedRawRows] = useState<Record<string, any>[]>([]);

  // Field mapping state: systemFieldKey -> sourceColumnHeader
  const [fieldMapping, setFieldMapping] = useState<Record<string, string>>({});

  // Import Strategy
  const [importMode, setImportMode] = useState<BulkImportMode>('upsert');
  const [defaultCategoryId, setDefaultCategoryId] = useState<string>(categories[0]?.id || 'cat-retail');
  const [defaultTaxRate, setDefaultTaxRate] = useState<number>(7);
  const [skipInvalidRows, setSkipInvalidRows] = useState<boolean>(true);
  const [importNotes, setImportNotes] = useState<string>('Enterprise Inventory Bulk Update');

  // Preview & Filtering
  const [previewFilter, setPreviewFilter] = useState<'all' | 'valid' | 'warning' | 'error' | 'new' | 'update'>('all');
  const [previewSearch, setPreviewSearch] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [importResult, setImportResult] = useState<BulkImportResult | null>(null);

  // Reset state on open
  useEffect(() => {
    if (isOpen) {
      setCurrentStep('upload');
      setFileName('');
      setFileSize(null);
      setParsedHeaders([]);
      setParsedRawRows([]);
      setFieldMapping({});
      setImportResult(null);
      setIsProcessing(false);
      setRawPastedText('');
    }
  }, [isOpen]);

  // Robust CSV Parsing helper supporting quotes and commas
  const parseCSV = (text: string): { headers: string[]; rows: Record<string, any>[] } => {
    // Strip BOM
    const cleanText = text.replace(/^\uFEFF/, '').trim();
    if (!cleanText) return { headers: [], rows: [] };

    // Auto-detect delimiter
    const firstLine = cleanText.split(/\r\n|\n|\r/)[0];
    let delimiter = ',';
    if ((firstLine.match(/\t/g) || []).length > (firstLine.match(/,/g) || []).length) {
      delimiter = '\t';
    } else if ((firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length) {
      delimiter = ';';
    }

    const lines: string[][] = [];
    let currentRow: string[] = [];
    let currentCell = '';
    let insideQuotes = false;

    for (let i = 0; i < cleanText.length; i++) {
      const char = cleanText[i];
      const nextChar = cleanText[i + 1];

      if (char === '"') {
        if (insideQuotes && nextChar === '"') {
          currentCell += '"';
          i++; // Skip escaped quote
        } else {
          insideQuotes = !insideQuotes;
        }
      } else if (char === delimiter && !insideQuotes) {
        currentRow.push(currentCell.trim());
        currentCell = '';
      } else if ((char === '\r' || char === '\n') && !insideQuotes) {
        if (char === '\r' && nextChar === '\n') i++;
        currentRow.push(currentCell.trim());
        if (currentRow.some((c) => c.length > 0)) {
          lines.push(currentRow);
        }
        currentRow = [];
        currentCell = '';
      } else {
        currentCell += char;
      }
    }

    if (currentCell.length > 0 || currentRow.length > 0) {
      currentRow.push(currentCell.trim());
      if (currentRow.some((c) => c.length > 0)) {
        lines.push(currentRow);
      }
    }

    if (lines.length === 0) return { headers: [], rows: [] };

    const headers = lines[0].map((h) => h.replace(/^["']|["']$/g, '').trim());
    const dataRows = lines.slice(1);

    const rows: Record<string, any>[] = dataRows.map((row) => {
      const rowObj: Record<string, any> = {};
      headers.forEach((h, idx) => {
        rowObj[h] = row[idx] !== undefined ? row[idx] : '';
      });
      return rowObj;
    });

    return { headers, rows };
  };

  // Robust JSON Parsing helper
  const parseJSON = (text: string): { headers: string[]; rows: Record<string, any>[] } => {
    const parsed = JSON.parse(text);
    let items: any[] = [];
    if (Array.isArray(parsed)) {
      items = parsed;
    } else if (parsed && typeof parsed === 'object') {
      if (Array.isArray(parsed.products)) items = parsed.products;
      else if (Array.isArray(parsed.items)) items = parsed.items;
      else if (Array.isArray(parsed.data)) items = parsed.data;
      else if (Array.isArray(parsed.inventory)) items = parsed.inventory;
      else items = [parsed];
    }

    if (!items || items.length === 0) return { headers: [], rows: [] };

    // Collect all unique keys
    const headerSet = new Set<string>();
    items.forEach((item) => {
      if (item && typeof item === 'object') {
        Object.keys(item).forEach((k) => headerSet.add(k));
      }
    });

    const headers = Array.from(headerSet);
    const rows = items.map((item) => {
      const rowObj: Record<string, any> = {};
      headers.forEach((h) => {
        rowObj[h] = item[h] !== undefined ? item[h] : '';
      });
      return rowObj;
    });

    return { headers, rows };
  };

  // Process uploaded or pasted data
  const handleDataParsed = (headers: string[], rows: Record<string, any>[], name: string, size?: number) => {
    if (headers.length === 0 || rows.length === 0) {
      addToast({
        title: language === 'th' ? 'ไม่พบข้อมูลในไฟล์' : 'Empty Data File',
        message: language === 'th' ? 'กรุณาตรวจสอบว่าไฟล์มีหัวตารางและแถวข้อมูลถูกต้อง' : 'No rows or headers detected in file.',
        type: 'warning',
      });
      return;
    }

    setFileName(name);
    if (size) setFileSize(size);
    setParsedHeaders(headers);
    setParsedRawRows(rows);

    // Smart Auto-Mapping
    const initialMapping: Record<string, string> = {};
    const normalizedHeaders = headers.map((h) => {
      const trimmed = h.trim();
      const lower = trimmed.toLowerCase();
      return {
        original: trimmed,
        clean: lower.replace(/[\s\-_.]+/g, '_'),
        alphaNumeric: lower.replace(/[^a-z0-9]/g, ''),
      };
    });

    SYSTEM_FIELDS.forEach((sysField) => {
      for (const norm of normalizedHeaders) {
        if (
          norm.clean === sysField.key.toLowerCase() ||
          norm.alphaNumeric === sysField.key.toLowerCase() ||
          sysField.aliases.some((alias) => {
            const cleanAlias = alias.toLowerCase().replace(/[\s\-_.]+/g, '_');
            return (
              norm.clean === cleanAlias ||
              norm.clean.includes(cleanAlias) ||
              norm.original.toLowerCase().includes(alias.toLowerCase())
            );
          })
        ) {
          initialMapping[sysField.key] = norm.original;
          break;
        }
      }
    });

    setFieldMapping(initialMapping);
    setCurrentStep('mapping');

    addToast({
      title: language === 'th' ? 'นำเข้าไฟล์สำเร็จ' : 'File Parsed Successfully',
      message: language === 'th' ? `ตรวจพบ ${rows.length} รายการ และ ${headers.length} คอลัมน์` : `Detected ${rows.length} rows with ${headers.length} columns.`,
      type: 'success',
    });
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        if (file.name.endsWith('.json')) {
          const { headers, rows } = parseJSON(text);
          handleDataParsed(headers, rows, file.name, file.size);
        } else {
          const { headers, rows } = parseCSV(text);
          handleDataParsed(headers, rows, file.name, file.size);
        }
      } catch (err: any) {
        addToast({
          title: language === 'th' ? 'อ่านไฟล์ไม่สำเร็จ' : 'Parsing Failed',
          message: err?.message || 'Failed to parse file.',
          type: 'error',
        });
      }
    };
    reader.readAsText(file);
  };

  const handlePasteProcess = () => {
    if (!rawPastedText.trim()) {
      addToast({
        title: language === 'th' ? 'กรุณาวางข้อมูล' : 'Paste Data First',
        message: language === 'th' ? 'โปรดวางข้อมูลในรูปแบบ CSV หรือ JSON' : 'Please paste CSV or JSON content.',
        type: 'warning',
      });
      return;
    }

    try {
      const trimmed = rawPastedText.trim();
      if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
        const { headers, rows } = parseJSON(trimmed);
        handleDataParsed(headers, rows, 'Pasted_Data.json', new Blob([trimmed]).size);
      } else {
        const { headers, rows } = parseCSV(trimmed);
        handleDataParsed(headers, rows, 'Pasted_Data.csv', new Blob([trimmed]).size);
      }
    } catch (err: any) {
      addToast({
        title: language === 'th' ? 'รูปแบบข้อมูลไม่ถูกต้อง' : 'Invalid Data Format',
        message: err?.message || 'Could not parse pasted data.',
        type: 'error',
      });
    }
  };

  // Sample Template Download Generator
  const downloadSampleTemplate = (format: 'csv' | 'json' | 'current_catalog') => {
    if (format === 'current_catalog') {
      const csvContent = generateInventoryCsv(existingProducts as Product[], categories as Category[]);
      downloadCsvFile(`PRODX_Inventory_Catalog_${new Date().toISOString().split('T')[0]}`, csvContent);
      addToast({
        title: language === 'th' ? 'ส่งออกสต็อกปัจจุบันสำเร็จ' : 'Catalog Exported',
        message:
          language === 'th'
            ? `ส่งออกข้อมูลสินค้าปัจจุบัน ${existingProducts.length} รายการเป็น CSV เรียบร้อยแล้ว`
            : `Exported ${existingProducts.length} current catalog items to CSV.`,
        type: 'success',
      });
    } else if (format === 'csv') {
      downloadCsvFile('PRODX_Inventory_Import_Template', getBlankCsvTemplate());
    } else {
      const sampleJson = JSON.stringify(
        [
          {
            sku: 'BEV-MAT-01',
            barcode: '890123450090',
            name: 'Organic Uji Matcha Latte',
            category: 'cat-coffee',
            price: 95.0,
            cost_price: 32.0,
            stock: 50,
            reorder_point: 15,
            unit: 'cup',
            tax_rate: 7,
            description: 'Ceremonial grade matcha with steamed oat milk',
          },
          {
            sku: 'BAK-CRO-02',
            barcode: '890123450091',
            name: 'Salted Egg Yolk Croissant',
            category: 'cat-bakery',
            price: 85.0,
            cost_price: 28.0,
            stock: 24,
            reorder_point: 10,
            unit: 'piece',
            tax_rate: 7,
            description: 'Hand-rolled butter croissant with creamy custard',
          },
          {
            sku: 'RET-MUG-03',
            barcode: '890123450092',
            name: 'PRODX Thermal Travel Flask',
            category: 'cat-retail',
            price: 650.0,
            cost_price: 220.0,
            stock: 30,
            reorder_point: 5,
            unit: 'unit',
            tax_rate: 7,
            description: 'Double-wall stainless steel insulated flask',
          },
        ],
        null,
        2
      );

      const blob = new Blob([sampleJson], { type: 'application/json;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'PRODX_Inventory_Import_Template.json');
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }
  };

  // Helper to parse currency or numeric values from string
  const parseNumeric = (val: any): number | undefined => {
    if (val === undefined || val === null || val === '') return undefined;
    if (typeof val === 'number') return isNaN(val) ? undefined : val;
    const cleanStr = String(val).replace(/[^0-9.-]/g, '');
    const num = parseFloat(cleanStr);
    return isNaN(num) ? undefined : num;
  };

  // Pre-Import Validation Engine
  const validatedRows: ValidatedRow[] = useMemo(() => {
    if (parsedRawRows.length === 0) return [];

    const seenSkusInBatch = new Set<string>();
    const skuField = fieldMapping['sku'];
    const nameField = fieldMapping['name'];
    const barcodeField = fieldMapping['barcode'];
    const priceField = fieldMapping['priceAmountInCents'];
    const costField = fieldMapping['costPriceAmountInCents'];
    const stockField = fieldMapping['currentStock'];
    const reorderField = fieldMapping['reorderPoint'];
    const categoryField = fieldMapping['category'];
    const unitField = fieldMapping['unitOfMeasure'];
    const taxField = fieldMapping['taxRateBps'];
    const descField = fieldMapping['description'];

    return parsedRawRows.map((rawRow, idx) => {
      const rowNumber = idx + 1;
      const errors: string[] = [];
      const warnings: string[] = [];

      // Extract values based on mapping
      const rawSku = skuField ? String(rawRow[skuField] || '').trim() : '';
      const rawName = nameField ? String(rawRow[nameField] || '').trim() : '';
      const rawBarcode = barcodeField ? String(rawRow[barcodeField] || '').trim() : '';
      const rawPrice = priceField ? rawRow[priceField] : undefined;
      const rawCost = costField ? rawRow[costField] : undefined;
      const rawStock = stockField ? rawRow[stockField] : undefined;
      const rawReorder = reorderField ? rawRow[reorderField] : undefined;
      const rawCategory = categoryField ? String(rawRow[categoryField] || '').trim() : '';
      const rawUnit = unitField ? String(rawRow[unitField] || '').trim() : '';
      const rawTax = taxField ? rawRow[taxField] : undefined;
      const rawDesc = descField ? String(rawRow[descField] || '').trim() : '';

      // Validate SKU
      if (!rawSku) {
        errors.push(language === 'th' ? 'ไม่พบรหัสสินค้า (SKU ว่างเปล่า)' : 'Missing mandatory SKU identifier');
      } else if (seenSkusInBatch.has(rawSku.toLowerCase())) {
        errors.push(
          language === 'th'
            ? `รหัสสินค้า "${rawSku}" ซ้ำกันในชุดข้อมูลที่อัปโหลด`
            : `Duplicate SKU "${rawSku}" found within the upload dataset`
        );
      } else {
        seenSkusInBatch.add(rawSku.toLowerCase());
      }

      // Check existing product in catalog
      const existing = existingProducts.find(
        (p) =>
          p.sku.toLowerCase() === rawSku.toLowerCase() ||
          (rawBarcode && p.barcode.toLowerCase() === rawBarcode.toLowerCase())
      );
      const isExisting = Boolean(existing);

      if (!isExisting && !rawName && rawSku) {
        warnings.push(
          language === 'th'
            ? 'ไม่มีชื่อสินค้า ระบบจะตั้งชื่อเริ่มต้นให้'
            : 'Missing product name for new SKU (will fallback to item SKU)'
        );
      }

      // Validate Price: standard input is in currency units (e.g. 85.00 or 1500) -> convert to cents (8500 or 150000)
      let priceAmountInCents: number | undefined = undefined;
      if (rawPrice !== undefined && rawPrice !== '') {
        const num = parseNumeric(rawPrice);
        if (num === undefined) {
          errors.push(language === 'th' ? `ราคา "${rawPrice}" ไม่ใช่ตัวเลขที่ถูกต้อง` : `Invalid price format "${rawPrice}"`);
        } else if (num < 0) {
          errors.push(language === 'th' ? 'ราคาขายต้องไม่ติดลบ' : 'Price cannot be negative');
        } else {
          const isExplicitCents = priceField ? (priceField.toLowerCase().includes('cent') || priceField.toLowerCase().includes('satang')) : false;
          priceAmountInCents = isExplicitCents ? Math.trunc(num) : parseDecimalToCents(String(rawPrice));
        }
      }

      // Validate Cost: standard input is in currency units
      let costPriceAmountInCents: number | undefined = undefined;
      if (rawCost !== undefined && rawCost !== '') {
        const num = parseNumeric(rawCost);
        if (num === undefined) {
          errors.push(language === 'th' ? `ราคาทุน "${rawCost}" ไม่ใช่ตัวเลขที่ถูกต้อง` : `Invalid cost format "${rawCost}"`);
        } else if (num < 0) {
          errors.push(language === 'th' ? 'ราคาทุนต้องไม่ติดลบ' : 'Cost cannot be negative');
        } else {
          const isExplicitCostCents = costField ? (costField.toLowerCase().includes('cent') || costField.toLowerCase().includes('satang')) : false;
          costPriceAmountInCents = isExplicitCostCents ? Math.trunc(num) : parseDecimalToCents(String(rawCost));
        }
      }

      if (priceAmountInCents !== undefined && costPriceAmountInCents !== undefined) {
        if (costPriceAmountInCents > priceAmountInCents) {
          warnings.push(
            language === 'th'
              ? 'ราคาทุนสูงกว่าราคาขายปลีก (กำไรติดลบ)'
              : 'Cost price exceeds retail sale price (negative margin warning)'
          );
        }
      }

      // Validate Stock
      let currentStock: number | undefined = undefined;
      if (rawStock !== undefined && rawStock !== '') {
        const num = parseNumeric(rawStock);
        if (num === undefined) {
          errors.push(language === 'th' ? `จำนวนสต็อก "${rawStock}" ไม่ถูกต้อง` : `Invalid stock quantity "${rawStock}"`);
        } else {
          currentStock = Math.trunc(num);
        }
      }

      // Validate Reorder Point
      let reorderPoint: number | undefined = undefined;
      if (rawReorder !== undefined && rawReorder !== '') {
        const num = parseNumeric(rawReorder);
        if (num !== undefined) {
          reorderPoint = Math.max(0, Math.trunc(num));
        }
      }

      // Validate Tax Rate
      let taxRateBps: number | undefined = undefined;
      if (rawTax !== undefined && rawTax !== '') {
        const num = parseNumeric(rawTax);
        if (num !== undefined) {
          taxRateBps = num <= 100 ? parseDecimalToBps(String(rawTax)) : Math.trunc(num);
        }
      }

      // Category matching
      let categoryId: string | undefined = undefined;
      let categoryName: string | undefined = undefined;
      if (rawCategory) {
        const match = categories.find(
          (c) => c.id.toLowerCase() === rawCategory.toLowerCase() || c.name.toLowerCase() === rawCategory.toLowerCase()
        );
        if (match) {
          categoryId = match.id;
          categoryName = match.name;
        } else {
          categoryName = rawCategory;
          warnings.push(
            language === 'th'
              ? `หมวดหมู่ "${rawCategory}" เป็นหมวดใหม่ ระบบจะสร้างให้อัตโนมัติ`
              : `Category "${rawCategory}" does not exist yet (will auto-create)`
          );
        }
      }

      // Build parsed object - preserves existing product fields if not specified in CSV
      const parsedItem: BulkImportItem = {
        sku: rawSku,
        name: rawName ? rawName : (isExisting ? undefined : `Item ${rawSku}`),
        barcode: rawBarcode || undefined,
        description: rawDesc ? rawDesc : undefined,
        categoryId: categoryId ? categoryId : (isExisting ? undefined : defaultCategoryId),
        categoryName: categoryName,
        priceAmountInCents: priceAmountInCents,
        costPriceAmountInCents: costPriceAmountInCents,
        currentStock: currentStock,
        reorderPoint: reorderPoint !== undefined ? reorderPoint : (isExisting ? undefined : 10),
        unitOfMeasure: rawUnit ? rawUnit : (isExisting ? undefined : 'piece'),
        taxRateBps: taxRateBps !== undefined ? taxRateBps : (isExisting ? undefined : defaultTaxRate * 100),
      };

      // Determine status
      let status: 'valid_new' | 'valid_update' | 'warning' | 'error' = 'valid_new';
      if (errors.length > 0) {
        status = 'error';
      } else if (warnings.length > 0) {
        status = 'warning';
      } else if (isExisting) {
        status = 'valid_update';
      } else {
        status = 'valid_new';
      }

      return {
        rowNumber,
        raw: rawRow,
        parsed: parsedItem,
        status,
        isExisting,
        existingProduct: existing,
        errors,
        warnings,
      };
    });
  }, [parsedRawRows, fieldMapping, existingProducts, categories, defaultCategoryId, defaultTaxRate, language]);

  // Validation Metrics Summary
  const validationSummary = useMemo(() => {
    const total = validatedRows.length;
    const errorsCount = validatedRows.filter((r) => r.status === 'error').length;
    const warningsCount = validatedRows.filter((r) => r.status === 'warning').length;
    const newItemsCount = validatedRows.filter((r) => !r.isExisting && r.status !== 'error').length;
    const updatesCount = validatedRows.filter((r) => r.isExisting && r.status !== 'error').length;
    const validCount = total - errorsCount;

    return {
      total,
      errorsCount,
      warningsCount,
      newItemsCount,
      updatesCount,
      validCount,
    };
  }, [validatedRows]);

  // Filtered Preview Rows
  const filteredPreviewRows = useMemo(() => {
    return validatedRows.filter((row) => {
      // Filter by status tab
      if (previewFilter === 'valid' && row.status === 'error') return false;
      if (previewFilter === 'warning' && row.status !== 'warning') return false;
      if (previewFilter === 'error' && row.status !== 'error') return false;
      if (previewFilter === 'new' && (row.isExisting || row.status === 'error')) return false;
      if (previewFilter === 'update' && (!row.isExisting || row.status === 'error')) return false;

      // Filter by search query
      if (previewSearch.trim()) {
        const q = previewSearch.toLowerCase().trim();
        const skuMatch = row.parsed.sku.toLowerCase().includes(q);
        const nameMatch = (row.parsed.name || '').toLowerCase().includes(q);
        const barcodeMatch = (row.parsed.barcode || '').includes(q);
        if (!skuMatch && !nameMatch && !barcodeMatch) return false;
      }

      return true;
    });
  }, [validatedRows, previewFilter, previewSearch]);

  // Execute Bulk Import
  const handleExecuteImport = async () => {
    if (!session) return;
    if (!can('inventory:adjust') && session.currentUser.role !== 'admin') {
      addToast({
        title: language === 'th' ? 'ไม่มีสิทธิ์ดำเนินการ' : 'Permission Denied',
        message: language === 'th' ? 'ต้องใช้สิทธิ์แอดมินหรือผู้จัดการคลังสินค้า' : 'Admin or inventory permission required.',
        type: 'error',
      });
      return;
    }

    const rowsToImport = skipInvalidRows
      ? validatedRows.filter((r) => r.status !== 'error')
      : validatedRows;

    if (rowsToImport.length === 0) {
      addToast({
        title: language === 'th' ? 'ไม่มีรายการที่นำเข้าได้' : 'No Valid Items',
        message: language === 'th' ? 'ไม่มีข้อมูลที่ผ่านการตรวจสอบ กรุณาแก้ไขข้อผิดพลาด' : 'All rows failed validation.',
        type: 'warning',
      });
      return;
    }

    setIsProcessing(true);
    try {
      const itemsPayload = rowsToImport.map((r) => r.parsed);
      const result = await catalogApi.bulkImportProducts(
        session.currentStore.id,
        itemsPayload,
        importMode,
        session.currentUser.id,
        importNotes
      );

      setImportResult(result);
      setCurrentStep('result');
      onImportComplete(result);

      addToast({
        title: language === 'th' ? 'นำเข้าสินค้าสำเร็จ' : 'Bulk Import Successful',
        message:
          language === 'th'
            ? `สร้างใหม่ ${result.createdCount} รายการ, อัปเดต ${result.updatedCount} รายการ`
            : `Created ${result.createdCount} new products, updated ${result.updatedCount} existing items.`,
        type: 'success',
      });
    } catch (err: any) {
      addToast({
        title: language === 'th' ? 'นำเข้าข้อมูลไม่สำเร็จ' : 'Bulk Import Failed',
        message: err?.message || 'Error occurred during import processing.',
        type: 'error',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        language === 'th'
          ? 'นำเข้าสินค้าคงคลังแบบกลุ่ม (Bulk Inventory Import)'
          : 'Enterprise Bulk Inventory Import'
      }
      description={
        language === 'th'
          ? 'อัปโหลดไฟล์ CSV/JSON เพื่อสร้างหรืออัปเดตแคตตาล็อก ปรับสต็อก และตั้งราคาแบบเรียลไทม์'
          : 'Parse CSV/JSON files, map fields, validate data, and execute auditable enterprise catalog updates.'
      }
      maxWidth="4xl"
      footer={
        <div className="flex items-center justify-between w-full">
          {/* Step Back / Cancel */}
          <div>
            {currentStep === 'upload' && (
              <Button variant="ghost" size="sm" onClick={onClose}>
                {language === 'th' ? 'ยกเลิก' : 'Cancel'}
              </Button>
            )}
            {currentStep === 'mapping' && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setCurrentStep('upload')}
                leftIcon={<ArrowLeft className="h-4 w-4" />}
              >
                {language === 'th' ? 'ย้อนกลับ' : 'Back'}
              </Button>
            )}
            {currentStep === 'preview' && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setCurrentStep('mapping')}
                leftIcon={<ArrowLeft className="h-4 w-4" />}
                disabled={isProcessing}
              >
                {language === 'th' ? 'แก้ไขการแมปฟิลด์' : 'Edit Mapping'}
              </Button>
            )}
            {currentStep === 'result' && (
              <Button variant="secondary" size="sm" onClick={onClose}>
                {language === 'th' ? 'ปิดหน้าต่าง' : 'Close'}
              </Button>
            )}
          </div>

          {/* Step Forward / Execute */}
          <div className="flex items-center gap-2">
            {currentStep === 'mapping' && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  if (!fieldMapping['sku']) {
                    addToast({
                      title: language === 'th' ? 'จำเป็นต้องแมป SKU' : 'SKU Mapping Required',
                      message:
                        language === 'th'
                          ? 'กรุณาเลือกคอลัมน์ที่ตรงกับ รหัสสินค้า (SKU)'
                          : 'Please map a source column to the SKU identifier.',
                      type: 'warning',
                    });
                    return;
                  }
                  setCurrentStep('preview');
                }}
                rightIcon={<ArrowRight className="h-4 w-4" />}
              >
                {language === 'th' ? 'ตรวจสอบข้อมูล & พรีวิว' : 'Validate & Preview'}
              </Button>
            )}

            {currentStep === 'preview' && (
              <Button
                variant="primary"
                size="sm"
                onClick={handleExecuteImport}
                disabled={isProcessing || (validationSummary.validCount === 0 && skipInvalidRows)}
                leftIcon={isProcessing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              >
                {isProcessing
                  ? language === 'th'
                    ? 'กำลังประมวลผล...'
                    : 'Processing Import...'
                  : language === 'th'
                  ? `ยืนยันนำเข้า (${skipInvalidRows ? validationSummary.validCount : validationSummary.total} รายการ)`
                  : `Commit Import (${skipInvalidRows ? validationSummary.validCount : validationSummary.total} items)`}
              </Button>
            )}

            {currentStep === 'result' && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  onClose();
                }}
              >
                {language === 'th' ? 'กลับไปที่หน้าสต็อก' : 'Return to Inventory'}
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div className="space-y-6">
        {/* Step Indicator Wizard Header */}
        <div className="grid grid-cols-4 gap-2 pb-2 border-b border-border/60">
          {[
            { id: 'upload', label: language === 'th' ? '1. อัปโหลดไฟล์' : '1. Upload File', icon: <UploadCloud className="h-3.5 w-3.5" /> },
            { id: 'mapping', label: language === 'th' ? '2. แมปคอลัมน์' : '2. Field Mapping', icon: <Sliders className="h-3.5 w-3.5" /> },
            { id: 'preview', label: language === 'th' ? '3. ตรวจสอบข้อมูล' : '3. Validation', icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
            { id: 'result', label: language === 'th' ? '4. สรุปผลการนำเข้า' : '4. Audit Report', icon: <FileText className="h-3.5 w-3.5" /> },
          ].map((step) => {
            const isActive = currentStep === step.id;
            const isDone =
              (step.id === 'upload' && currentStep !== 'upload') ||
              (step.id === 'mapping' && (currentStep === 'preview' || currentStep === 'result')) ||
              (step.id === 'preview' && currentStep === 'result');

            return (
              <div
                key={step.id}
                className={`flex items-center gap-1.5 p-2 rounded-xl text-xs font-bold transition-all ${
                  isActive
                    ? 'bg-primary text-white shadow-2xs'
                    : isDone
                    ? 'bg-primary/10 text-primary'
                    : 'bg-muted/50 text-text/40'
                }`}
              >
                {step.icon}
                <span className="truncate">{step.label}</span>
              </div>
            );
          })}
        </div>

        {/* ----------------- STEP 1: UPLOAD ----------------- */}
        {currentStep === 'upload' && (
          <div className="space-y-5">
            {/* Upload Method Toggle & Templates */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-muted/40 p-3 rounded-2xl border border-border border-crisp">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setUploadMode('file')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer transition-all ${
                    uploadMode === 'file'
                      ? 'bg-card text-primary shadow-xs border border-border'
                      : 'text-text/60 hover:text-text'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <FileSpreadsheet className="h-3.5 w-3.5" />
                    <span>{language === 'th' ? 'อัปโหลดไฟล์ (CSV / JSON)' : 'Upload File (CSV / JSON)'}</span>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setUploadMode('paste')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer transition-all ${
                    uploadMode === 'paste'
                      ? 'bg-card text-primary shadow-xs border border-border'
                      : 'text-text/60 hover:text-text'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <FileCode className="h-3.5 w-3.5" />
                    <span>{language === 'th' ? 'วางข้อความดิบ (Paste Raw)' : 'Paste Raw Text'}</span>
                  </div>
                </button>
              </div>

              {/* Sample Template Downloads */}
              <div className="flex items-center gap-1.5 self-end sm:self-auto flex-wrap">
                <span className="text-[11px] text-text/50 font-medium">
                  {language === 'th' ? 'ดาวน์โหลดเทมเพลต:' : 'Templates:'}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => downloadSampleTemplate('csv')}
                  leftIcon={<Download className="h-3 w-3" />}
                >
                  {language === 'th' ? 'แบบฟอร์มเปล่า (CSV)' : 'Blank CSV'}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => downloadSampleTemplate('current_catalog')}
                  leftIcon={<Download className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />}
                >
                  {language === 'th' ? 'สต็อกปัจจุบัน (CSV)' : 'Current Inventory (CSV)'}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => downloadSampleTemplate('json')}
                  leftIcon={<Download className="h-3 w-3" />}
                >
                  JSON
                </Button>
              </div>
            </div>

            {/* Mode A: Drag and drop file upload */}
            {uploadMode === 'file' && (
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const file = e.dataTransfer.files?.[0];
                  if (file) {
                    const fakeEvent = { target: { files: [file] } } as any;
                    handleFileUpload(fakeEvent);
                  }
                }}
                className="group p-8 sm:p-12 border-2 border-dashed border-border hover:border-primary/60 rounded-3xl bg-card hover:bg-primary/5 transition-all text-center cursor-pointer flex flex-col items-center justify-center space-y-3"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.json,.txt"
                  className="hidden"
                  onChange={handleFileUpload}
                />
                <div className="p-4 rounded-2xl bg-primary/10 text-primary group-hover:scale-110 transition-transform">
                  <UploadCloud className="h-8 w-8" />
                </div>
                <div>
                  <h4 className="font-bold text-sm text-text">
                    {language === 'th' ? 'คลิกหรือลากไฟล์มาวางที่นี่' : 'Click to browse or drag & drop file here'}
                  </h4>
                  <p className="text-xs text-text/50 mt-1">
                    {language === 'th'
                      ? 'รองรับไฟล์ .CSV (คอมมา, เซมิโคลอน, แท็บ) และ .JSON (ขนาดสูงสุด 10MB)'
                      : 'Supports .CSV (comma, tab, semicolon) and .JSON catalogs (up to 10MB)'}
                  </p>
                </div>
                <Badge variant="neutral" size="sm" className="font-mono text-[10px]">
                  UTF-8 / ASCII / Windows-874
                </Badge>
              </div>
            )}

            {/* Mode B: Raw Paste */}
            {uploadMode === 'paste' && (
              <div className="space-y-3">
                <textarea
                  rows={8}
                  value={rawPastedText}
                  onChange={(e) => setRawPastedText(e.target.value)}
                  placeholder={
                    'sku,name,price,stock\nBEV-ESP-01,Espresso Shot,65,100\nBEV-LAT-02,Oat Latte,85,50'
                  }
                  className="w-full p-4 rounded-2xl border border-border border-crisp bg-card text-text font-mono text-xs focus:ring-2 focus:ring-primary focus:outline-none"
                />
                <div className="flex justify-end">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handlePasteProcess}
                    leftIcon={<Sparkles className="h-4 w-4" />}
                  >
                    {language === 'th' ? 'ประมวลผลข้อความ' : 'Parse Pasted Data'}
                  </Button>
                </div>
              </div>
            )}

            {/* Enterprise Best Practice Guidance */}
            <div className="p-4 rounded-2xl bg-muted/40 border border-border border-crisp space-y-2 text-xs text-text/70">
              <div className="flex items-center gap-2 font-bold text-text">
                <Info className="h-4 w-4 text-primary shrink-0" />
                <span>{language === 'th' ? 'คำแนะนำสำหรับการนำเข้าไฟล์' : 'Enterprise Import Guidelines'}</span>
              </div>
              <ul className="list-disc list-inside space-y-1 text-[11px] text-text/60 ml-1">
                <li>{language === 'th' ? 'คอลัมน์ SKU เป็นฟิลด์หลักที่จำเป็นสำหรับการค้นหาและจับคู่สินค้า' : 'SKU column is strictly required to uniquely identify existing vs new items.'}</li>
                <li>{language === 'th' ? 'ระบบตรวจจับคอลัมน์ภาษาไทยและภาษาอังกฤษให้อัตโนมัติในขั้นตอนถัดไป' : 'Smart mapping automatically correlates varied column headers (e.g. price, retail_price, cogs).'}</li>
                <li>{language === 'th' ? 'ทุกการเปลี่ยนแปลงจำนวนสต็อกจะถูกบันทึกเข้า Audit Ledger ย้อนหลังเพื่อความโปร่งใส' : 'All stock balance updates generate immutable inventory ledger entries for audit compliance.'}</li>
              </ul>
            </div>
          </div>
        )}

        {/* ----------------- STEP 2: FIELD MAPPING ----------------- */}
        {currentStep === 'mapping' && (
          <div className="space-y-5">
            {/* File Info & Strategy Header */}
            <div className="p-4 rounded-2xl bg-card border border-border border-crisp flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <FileSpreadsheet className="h-4 w-4 text-primary" />
                  <span className="font-bold text-sm text-text">{fileName}</span>
                  <Badge variant="primary" size="sm">
                    {parsedRawRows.length} {language === 'th' ? 'แถว' : 'rows'}
                  </Badge>
                </div>
                <p className="text-[11px] text-text/50 mt-0.5">
                  {language === 'th'
                    ? 'จับคู่คอลัมน์จากไฟล์เข้ากับฟิลด์มาตรฐานของระบบ PRODX POS'
                    : 'Map uploaded file columns to PRODX catalog target schema attributes.'}
                </p>
              </div>

              {/* Strategy Selector */}
              <div className="flex items-center gap-2">
                <label className="text-xs font-bold text-text/70 whitespace-nowrap">
                  {language === 'th' ? 'โหมดนำเข้า:' : 'Import Mode:'}
                </label>
                <select
                  value={importMode}
                  onChange={(e) => setImportMode(e.target.value as BulkImportMode)}
                  className="px-3 py-1.5 rounded-xl border border-border border-crisp bg-background text-xs font-bold text-text focus:ring-2 focus:ring-primary focus:outline-none"
                >
                  <option value="upsert">
                    {language === 'th' ? 'Upsert (สร้างใหม่ & อัปเดตรายการเดิม)' : 'Upsert (Create New & Update Existing)'}
                  </option>
                  <option value="update_only">
                    {language === 'th' ? 'Update Only (อัปเดตเฉพาะสินค้าที่มีอยู่เดิม)' : 'Update Only (Skip Non-Existent SKUs)'}
                  </option>
                  <option value="stock_override">
                    {language === 'th' ? 'Audit Overwrite (แทนที่สต็อกด้วยยอดนับจริง)' : 'Audit Overwrite (Set Exact Count)'}
                  </option>
                  <option value="stock_replenish">
                    {language === 'th' ? 'Replenish (+ เพิ่มสต็อกจากการรับสินค้า)' : 'Replenish (+ Add Quantity to Stock)'}
                  </option>
                </select>
              </div>
            </div>

            {/* Mapping Table */}
            <div className="border border-border border-crisp rounded-2xl overflow-hidden bg-card">
              <div className="overflow-x-auto max-h-[380px] no-scrollbar">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-muted/70 text-text/70 uppercase text-[10px] font-bold sticky top-0 z-10 border-b border-border">
                    <tr>
                      <th className="p-3.5 pl-4">{language === 'th' ? 'ฟิลด์ระบบ' : 'System Field'}</th>
                      <th className="p-3.5">{language === 'th' ? 'สถานะ' : 'Requirement'}</th>
                      <th className="p-3.5">{language === 'th' ? 'คอลัมน์จากไฟล์ของคุณ' : 'Source Column'}</th>
                      <th className="p-3.5 pr-4">{language === 'th' ? 'ตัวอย่างข้อมูล (3 แถวแรก)' : 'Sample Data Preview'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {SYSTEM_FIELDS.map((field) => {
                      const selectedSourceCol = fieldMapping[field.key] || '';
                      const sampleValues = parsedRawRows
                        .slice(0, 3)
                        .map((r) => r[selectedSourceCol])
                        .filter((v) => v !== undefined && v !== '');

                      return (
                        <tr key={field.key} className="hover:bg-background/50 transition-colors">
                          <td className="p-3.5 pl-4">
                            <div className="font-bold text-text">
                              {language === 'th' ? field.labelTh : field.label}
                            </div>
                            <div className="text-[10px] text-text/50 font-mono">
                              {field.key}
                            </div>
                          </td>
                          <td className="p-3.5">
                            {field.required ? (
                              <Badge variant="danger" size="sm">
                                {language === 'th' ? 'จำเป็น' : 'Required'}
                              </Badge>
                            ) : (
                              <Badge variant="neutral" size="sm">
                                {language === 'th' ? 'ทางเลือก' : 'Optional'}
                              </Badge>
                            )}
                          </td>
                          <td className="p-3.5">
                            <select
                              value={selectedSourceCol}
                              onChange={(e) => {
                                const val = e.target.value;
                                setFieldMapping((prev) => {
                                  const next = { ...prev };
                                  if (!val) {
                                    delete next[field.key];
                                  } else {
                                    next[field.key] = val;
                                  }
                                  return next;
                                });
                              }}
                              className={`w-full max-w-xs px-3 py-1.5 rounded-xl border text-xs font-semibold focus:ring-2 focus:ring-primary focus:outline-none ${
                                selectedSourceCol
                                  ? 'border-primary/60 bg-primary/5 text-primary font-bold'
                                  : 'border-border bg-background text-text/70'
                              }`}
                            >
                              <option value="">{language === 'th' ? '-- ไม่ระบุ (ข้ามฟิลด์นี้) --' : '-- Ignore / Not Mapped --'}</option>
                              {parsedHeaders.map((h) => (
                                <option key={h} value={h}>
                                  {h}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="p-3.5 pr-4">
                            {sampleValues.length > 0 ? (
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {sampleValues.map((val, vIdx) => (
                                  <span
                                    key={vIdx}
                                    className="px-2 py-0.5 rounded-lg bg-muted border border-border/50 text-[11px] font-mono text-text/80 truncate max-w-[120px]"
                                    title={String(val)}
                                  >
                                    {String(val)}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span className="text-[11px] text-text/40 italic">
                                {language === 'th' ? 'ไม่มีข้อมูล' : 'No preview'}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Default Fallback Settings */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 rounded-2xl bg-muted/40 border border-border border-crisp">
              <div>
                <label className="block text-[11px] font-bold text-text/70 uppercase">
                  {language === 'th' ? 'หมวดหมู่เริ่มต้น (หากในไฟล์ไม่ระบุ)' : 'Default Fallback Category'}
                </label>
                <select
                  value={defaultCategoryId}
                  onChange={(e) => setDefaultCategoryId(e.target.value)}
                  className="mt-1.5 w-full px-3 py-2 rounded-xl border border-border border-crisp bg-background text-xs font-medium text-text"
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.id})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-text/70 uppercase">
                  {language === 'th' ? 'อัตราภาษีเริ่มต้น (VAT %)' : 'Default Tax Rate (VAT %)'}
                </label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={defaultTaxRate}
                  onChange={(e) => setDefaultTaxRate(parseFloat(e.target.value) || 0)}
                  className="mt-1.5 w-full px-3 py-2 rounded-xl border border-border border-crisp bg-background text-xs font-mono font-bold text-text"
                />
              </div>
            </div>
          </div>
        )}

        {/* ----------------- STEP 3: VALIDATION & PREVIEW ----------------- */}
        {currentStep === 'preview' && (
          <div className="space-y-4">
            {/* Validation Metrics KPI Row */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
              <div className="p-3 rounded-2xl bg-card border border-border border-crisp">
                <div className="text-[10px] font-bold text-text/50 uppercase">{language === 'th' ? 'ทั้งหมด' : 'Total Rows'}</div>
                <div className="text-xl font-black font-mono mt-1 text-text">{validationSummary.total}</div>
              </div>

              <div className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20">
                <div className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase">
                  {language === 'th' ? 'ผ่านการตรวจสอบ' : 'Valid Rows'}
                </div>
                <div className="text-xl font-black font-mono mt-1 text-emerald-600 dark:text-emerald-400">
                  {validationSummary.validCount}
                </div>
              </div>

              <div className="p-3 rounded-2xl bg-primary/10 border border-primary/20">
                <div className="text-[10px] font-bold text-primary uppercase">{language === 'th' ? 'สินค้าใหม่' : 'New SKUs'}</div>
                <div className="text-xl font-black font-mono mt-1 text-primary">{validationSummary.newItemsCount}</div>
              </div>

              <div className="p-3 rounded-2xl bg-indigo-500/10 border border-indigo-500/20">
                <div className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 uppercase">{language === 'th' ? 'อัปเดตเดิม' : 'Catalog Updates'}</div>
                <div className="text-xl font-black font-mono mt-1 text-indigo-600 dark:text-indigo-400">{validationSummary.updatesCount}</div>
              </div>

              <div className="p-3 rounded-2xl bg-rose-500/10 border border-rose-500/20 col-span-2 sm:col-span-1">
                <div className="text-[10px] font-bold text-rose-600 dark:text-rose-400 uppercase">{language === 'th' ? 'ข้อผิดพลาด' : 'Errors'}</div>
                <div className="text-xl font-black font-mono mt-1 text-rose-600 dark:text-rose-400">{validationSummary.errorsCount}</div>
              </div>
            </div>

            {/* Filter Tabs & Search Bar */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
              <div className="flex items-center gap-1 overflow-x-auto no-scrollbar py-1">
                <button
                  type="button"
                  onClick={() => setPreviewFilter('all')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                    previewFilter === 'all'
                      ? 'bg-primary text-white shadow-xs'
                      : 'bg-card border border-border text-text/70 hover:text-text'
                  }`}
                >
                  {language === 'th' ? 'ทั้งหมด' : 'All'} ({validationSummary.total})
                </button>

                <button
                  type="button"
                  onClick={() => setPreviewFilter('new')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                    previewFilter === 'new'
                      ? 'bg-primary text-white shadow-xs'
                      : 'bg-card border border-border text-text/70 hover:text-text'
                  }`}
                >
                  {language === 'th' ? 'สร้างใหม่' : 'New'} ({validationSummary.newItemsCount})
                </button>

                <button
                  type="button"
                  onClick={() => setPreviewFilter('update')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                    previewFilter === 'update'
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'bg-card border border-border text-text/70 hover:text-text'
                  }`}
                >
                  {language === 'th' ? 'อัปเดต' : 'Updates'} ({validationSummary.updatesCount})
                </button>

                {validationSummary.warningsCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setPreviewFilter('warning')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                      previewFilter === 'warning'
                        ? 'bg-amber-500 text-white shadow-xs'
                        : 'bg-card border border-border text-amber-600 hover:text-amber-700'
                    }`}
                  >
                    {language === 'th' ? 'คำเตือน' : 'Warnings'} ({validationSummary.warningsCount})
                  </button>
                )}

                {validationSummary.errorsCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setPreviewFilter('error')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                      previewFilter === 'error'
                        ? 'bg-rose-600 text-white shadow-xs'
                        : 'bg-card border border-border text-rose-600 hover:text-rose-700'
                    }`}
                  >
                    {language === 'th' ? 'ข้อผิดพลาด' : 'Errors'} ({validationSummary.errorsCount})
                  </button>
                )}
              </div>

              <div className="w-full sm:w-64">
                <SearchInput
                  value={previewSearch}
                  onChange={(e) => setPreviewSearch(e.target.value)}
                  onClear={() => setPreviewSearch('')}
                  placeholder={language === 'th' ? 'ค้นหา SKU หรือชื่อ...' : 'Search preview...'}
                />
              </div>
            </div>

            {/* Validation Data Table */}
            <div className="border border-border border-crisp rounded-2xl overflow-hidden bg-card">
              <div className="overflow-x-auto max-h-[340px] no-scrollbar">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-muted/70 text-text/70 uppercase text-[10px] font-bold sticky top-0 z-10 border-b border-border">
                    <tr>
                      <th className="p-3 pl-4">#</th>
                      <th className="p-3">{language === 'th' ? 'สถานะ' : 'Status'}</th>
                      <th className="p-3">{language === 'th' ? 'รหัส SKU' : 'SKU'}</th>
                      <th className="p-3">{language === 'th' ? 'ชื่อสินค้า' : 'Product Name'}</th>
                      <th className="p-3">{language === 'th' ? 'ราคาขาย' : 'Price'}</th>
                      <th className="p-3">{language === 'th' ? 'ราคาทุน' : 'Cost'}</th>
                      <th className="p-3">{language === 'th' ? 'สต็อก' : 'Stock'}</th>
                      <th className="p-3 pr-4">{language === 'th' ? 'ข้อความตรวจสอบ' : 'Validation Diagnostic'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60 font-medium">
                    {filteredPreviewRows.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="p-8 text-center text-text/50">
                          {language === 'th' ? 'ไม่พบรายการที่ตรงกับเงื่อนไข' : 'No matching rows in this filter view.'}
                        </td>
                      </tr>
                    ) : (
                      filteredPreviewRows.map((row) => {
                        const isErr = row.status === 'error';
                        const isWarn = row.status === 'warning';
                        const isUpd = row.status === 'valid_update';

                        return (
                          <tr
                            key={row.rowNumber}
                            className={`transition-colors ${
                              isErr
                                ? 'bg-rose-500/5 hover:bg-rose-500/10'
                                : isWarn
                                ? 'bg-amber-500/5 hover:bg-amber-500/10'
                                : 'hover:bg-background/60'
                            }`}
                          >
                            <td className="p-3 pl-4 font-mono text-[11px] text-text/40">{row.rowNumber}</td>
                            <td className="p-3">
                              {isErr ? (
                                <Badge variant="danger" size="sm" className="gap-1">
                                  <XCircle className="h-3 w-3" /> Error
                                </Badge>
                              ) : isWarn ? (
                                <Badge variant="warning" size="sm" className="gap-1">
                                  <AlertTriangle className="h-3 w-3" /> Warning
                                </Badge>
                              ) : isUpd ? (
                                <Badge variant="primary" size="sm" className="gap-1">
                                  <RefreshCw className="h-3 w-3" /> Update
                                </Badge>
                              ) : (
                                <Badge variant="success" size="sm" className="gap-1">
                                  <CheckCircle2 className="h-3 w-3" /> New
                                </Badge>
                              )}
                            </td>
                            <td className="p-3 font-mono font-bold text-text">{row.parsed.sku || '—'}</td>
                            <td className="p-3 font-medium text-text max-w-[180px] truncate" title={row.parsed.name}>
                              {row.parsed.name || '—'}
                            </td>
                            <td className="p-3 font-mono">
                              {row.isExisting && row.existingProduct && row.parsed.priceAmountInCents !== undefined && row.parsed.priceAmountInCents !== row.existingProduct.price.amountInCents ? (
                                <div className="flex flex-col">
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-text/40 line-through text-[11px]">
                                      ฿{(row.existingProduct.price.amountInCents / 100).toFixed(2)}
                                    </span>
                                    <span className="text-primary font-bold">
                                      ฿{(row.parsed.priceAmountInCents / 100).toFixed(2)}
                                    </span>
                                  </div>
                                  <span className="text-[10px] text-primary/70 font-semibold">
                                    {language === 'th' ? 'เปลี่ยนราคา' : 'Price update'}
                                  </span>
                                </div>
                              ) : row.parsed.priceAmountInCents !== undefined ? (
                                `฿${(row.parsed.priceAmountInCents / 100).toFixed(2)}`
                              ) : (
                                '—'
                              )}
                            </td>
                            <td className="p-3 font-mono text-text/60">
                              {row.parsed.costPriceAmountInCents !== undefined
                                ? `฿${(row.parsed.costPriceAmountInCents / 100).toFixed(2)}`
                                : '—'}
                            </td>
                            <td className="p-3 font-mono font-bold">
                              {row.isExisting && row.existingProduct ? (
                                (() => {
                                  const current = row.existingProduct.currentStock;
                                  let next = current;
                                  let delta = 0;
                                  if (importMode === 'stock_replenish') {
                                    delta = row.parsed.currentStock ?? 0;
                                    next = Math.max(0, current + delta);
                                  } else {
                                    if (row.parsed.currentStock !== undefined) {
                                      next = Math.max(0, row.parsed.currentStock);
                                      delta = next - current;
                                    }
                                  }
                                  return (
                                    <div className="flex flex-col">
                                      <div className="flex items-center gap-1.5">
                                        <span className="text-text/50">{current}</span>
                                        <span className="text-text/30">→</span>
                                        <span className="text-indigo-600 dark:text-indigo-400 font-bold">{next}</span>
                                        {delta !== 0 && (
                                          <span
                                            className={`text-[10px] px-1 py-0.5 rounded font-mono font-bold leading-none ${
                                              delta > 0
                                                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                                                : 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                                            }`}
                                          >
                                            {delta > 0 ? `+${delta}` : delta}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })()
                              ) : row.parsed.currentStock !== undefined ? (
                                <span className="text-emerald-600 dark:text-emerald-400">
                                  {row.parsed.currentStock}
                                </span>
                              ) : (
                                '—'
                              )}
                            </td>
                            <td className="p-3 pr-4 text-[11px]">
                              {row.errors.length > 0 ? (
                                <span className="text-rose-600 dark:text-rose-400 font-semibold">
                                  {row.errors.join('; ')}
                                </span>
                              ) : row.warnings.length > 0 ? (
                                <span className="text-amber-600 dark:text-amber-400">
                                  {row.warnings.join('; ')}
                                </span>
                              ) : (
                                <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                                  {row.isExisting
                                    ? language === 'th'
                                      ? 'จับคู่สินค้าเดิมสำเร็จ'
                                      : 'Matched existing SKU'
                                    : language === 'th'
                                    ? 'พร้อมสร้างรายการใหม่'
                                    : 'Ready to create'}
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Error Handling Toggle & Batch Notes */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4 rounded-2xl bg-muted/40 border border-border border-crisp">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="skip_invalid"
                  checked={skipInvalidRows}
                  onChange={(e) => setSkipInvalidRows(e.target.checked)}
                  className="rounded border-border text-primary focus:ring-primary h-4 w-4"
                />
                <label htmlFor="skip_invalid" className="text-xs font-bold text-text cursor-pointer">
                  {language === 'th'
                    ? `ข้ามแถวที่มีข้อผิดพลาด (${validationSummary.errorsCount} แถว) และนำเข้าเฉพาะแถวที่ถูกต้อง`
                    : `Skip invalid rows (${validationSummary.errorsCount}) and import remaining valid items`}
                </label>
              </div>

              <div className="w-full sm:w-72">
                <input
                  type="text"
                  value={importNotes}
                  onChange={(e) => setImportNotes(e.target.value)}
                  placeholder={language === 'th' ? 'บันทึกช่วยจำ (Audit Notes)...' : 'Audit ledger notes...'}
                  className="w-full px-3 py-1.5 rounded-xl border border-border border-crisp bg-background text-xs text-text"
                />
              </div>
            </div>
          </div>
        )}

        {/* ----------------- STEP 4: AUDIT RESULT ----------------- */}
        {currentStep === 'result' && importResult && (
          <div className="space-y-6 text-center py-4">
            <div className="p-4 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 w-16 h-16 mx-auto flex items-center justify-center">
              <CheckCircle2 className="h-10 w-10" />
            </div>

            <div>
              <h3 className="text-xl font-black text-text">
                {language === 'th' ? 'นำเข้าข้อมูลสินค้าคงคลังสำเร็จ!' : 'Inventory Bulk Update Committed'}
              </h3>
              <p className="text-xs text-text/60 mt-1">
                {language === 'th'
                  ? 'ข้อมูลสินค้าและประวัติการเคลื่อนไหวสต็อกถูกบันทึกลงระบบและซิงค์เรียบร้อยแล้ว'
                  : 'Product catalog snapshots, ledger entries, and audit logs have been committed.'}
              </p>
            </div>

            {/* Results Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-xl mx-auto text-left">
              <div className="p-4 rounded-2xl bg-card border border-border border-crisp">
                <div className="text-[10px] font-bold text-text/50 uppercase">{language === 'th' ? 'ประมวลผลทั้งหมด' : 'Processed'}</div>
                <div className="text-2xl font-black font-mono mt-1 text-text">{importResult.totalProcessed}</div>
              </div>

              <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20">
                <div className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase">{language === 'th' ? 'สร้างใหม่' : 'Created'}</div>
                <div className="text-2xl font-black font-mono mt-1 text-emerald-600 dark:text-emerald-400">{importResult.createdCount}</div>
              </div>

              <div className="p-4 rounded-2xl bg-indigo-500/10 border border-indigo-500/20">
                <div className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 uppercase">{language === 'th' ? 'อัปเดตเดิม' : 'Updated'}</div>
                <div className="text-2xl font-black font-mono mt-1 text-indigo-600 dark:text-indigo-400">{importResult.updatedCount}</div>
              </div>

              <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20">
                <div className="text-[10px] font-bold text-amber-600 dark:text-amber-400 uppercase">{language === 'th' ? 'ข้าม / ข้อผิดพลาด' : 'Skipped'}</div>
                <div className="text-2xl font-black font-mono mt-1 text-amber-600 dark:text-amber-400">{importResult.skippedCount}</div>
              </div>
            </div>

            {/* Batch Ref Tag */}
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted border border-border border-crisp text-xs font-mono text-text/70">
              <span>{language === 'th' ? 'รหัสอ้างอิงชุดงาน:' : 'Audit Batch Ref:'}</span>
              <span className="font-bold text-primary">{importResult.batchReference}</span>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};
