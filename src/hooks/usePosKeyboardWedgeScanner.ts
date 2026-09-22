import { useEffect, useRef, useState, useCallback } from 'react';
import { Product } from '../domain/catalog';
import { useCart } from '../context/CartContext';
import { useToast } from '../context/ToastContext';
import { useLanguage } from '../context/LanguageContext';
import { formatMoney } from '../domain/money';
import { createCatalogReadApi } from '../adapters/catalogApiFactory';
import { useAuth } from '../context/AuthContext';
import {
  createKeyboardWedgeScanner,
  KeyboardWedgeScannerInstance,
  WedgeScanEvent,
  KeyboardWedgeScannerConfig,
} from '../utils/keyboardWedgeScanner';

export interface UsePosKeyboardWedgeScannerOptions extends KeyboardWedgeScannerConfig {
  /**
   * Available product catalog to match against.
   */
  products: readonly Product[];

  /**
   * Whether to enable active scanning. Default: true.
   */
  enabled?: boolean;

  /**
   * Optional custom callback on successful item addition.
   */
  onItemAdded?: (product: Product, event: WedgeScanEvent) => void;
}

export interface UsePosKeyboardWedgeScannerReturn {
  lastScannedBarcode: string | null;
  lastScannedProduct: Product | null;
  lastScannedAt: Date | null;
  scanCount: number;
  isScanning: boolean;
  isFlashActive: boolean;
  activeIndicator: {
    id: number;
    name: string;
    barcode: string;
    price: string;
  } | null;
  simulateScan: (barcodeOrSku: string) => void;
  clearLastScan: () => void;
}

/**
 * React hook for the POS module that activates the global keyboard-wedge barcode scanner listener,
 * filters for valid product SKUs, and automatically adds scanned items to the active cart.
 */
export function usePosKeyboardWedgeScanner({
  products,
  enabled = true,
  maxIntervalMs = 50,
  minLength = 3,
  terminatorKeys = ['Enter', 'NumpadEnter', 'Tab'],
  prefix,
  preventDefault = true,
  captureInInputs = true,
  onItemAdded,
}: UsePosKeyboardWedgeScannerOptions): UsePosKeyboardWedgeScannerReturn {
  const { addItem } = useCart();
  const { addToast } = useToast();
  const { language } = useLanguage();
  const { session } = useAuth();
  const catalogApi = session ? createCatalogReadApi(session.token) : null;

  const [lastScannedBarcode, setLastScannedBarcode] = useState<string | null>(null);
  const [lastScannedProduct, setLastScannedProduct] = useState<Product | null>(null);
  const [lastScannedAt, setLastScannedAt] = useState<Date | null>(null);
  const [scanCount, setScanCount] = useState<number>(0);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [isFlashActive, setIsFlashActive] = useState<boolean>(false);
  const [activeIndicator, setActiveIndicator] = useState<{
    id: number;
    name: string;
    barcode: string;
    price: string;
  } | null>(null);

  const scannerInstanceRef = useRef<KeyboardWedgeScannerInstance | null>(null);
  const flashTimeoutRef = useRef<any>(null);
  const indicatorTimeoutRef = useRef<any>(null);

  // Trigger floating visual feedback and screen flash
  const triggerVisualFeedback = useCallback(
    (product: Product, barcodeOrSku: string) => {
      setIsFlashActive(true);
      if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
      flashTimeoutRef.current = setTimeout(() => {
        setIsFlashActive(false);
      }, 180);

      const indicatorId = Date.now();
      setActiveIndicator({
        id: indicatorId,
        name: product.name,
        barcode: barcodeOrSku,
        price: formatMoney(product.price),
      });

      if (indicatorTimeoutRef.current) clearTimeout(indicatorTimeoutRef.current);
      indicatorTimeoutRef.current = setTimeout(() => {
        setActiveIndicator(null);
      }, 2200);
    },
    []
  );

  // Core handler when a valid product SKU is matched
  const handleProductMatched = useCallback(
    (product: Product, event: WedgeScanEvent) => {
      addItem(product, 1, { isBarcodeScan: true });
      setLastScannedBarcode(event.normalizedSku);
      setLastScannedProduct(product);
      setLastScannedAt(event.timestamp);
      setScanCount((prev) => prev + 1);

      triggerVisualFeedback(product, event.normalizedSku);

      addToast({
        title:
          event.source === 'hardware_wedge'
            ? (language === 'th' ? 'สแกนเนอร์ฮาร์ดแวร์ตรวจพบสินค้า' : 'Hardware Barcode Scanned')
            : (language === 'th' ? 'สแกนบาร์โค้ดสำเร็จ' : 'Barcode Scanned'),
        message: `${product.name} • ${formatMoney(product.price)} (SKU: ${product.sku})`,
        type: 'info',
      });

      onItemAdded?.(product, event);
    },
    [addItem, addToast, language, onItemAdded, triggerVisualFeedback]
  );

  // Handler for out of stock products
  const handleOutOfStock = useCallback(
    (product: Product, event: WedgeScanEvent) => {
      setLastScannedBarcode(event.normalizedSku);
      setLastScannedProduct(product);
      setLastScannedAt(event.timestamp);

      addToast({
        title: language === 'th' ? 'สินค้าหมดสต็อก' : 'Product Out of Stock',
        message:
          language === 'th'
            ? `${product.name} (${event.normalizedSku}) หมดสต็อก ไม่สามารถเพิ่มในตะกร้าได้`
            : `${product.name} (${event.normalizedSku}) is currently out of stock.`,
        type: 'warning',
      });
    },
    [addToast, language]
  );

  // Handler for unrecognized / invalid SKUs (with remote catalog API fallback)
  const handleInvalidSku = useCallback(
    async (scannedSku: string, event: WedgeScanEvent) => {
      setLastScannedBarcode(scannedSku);
      setLastScannedAt(event.timestamp);

      // Attempt remote query fallback if catalog adapter has this barcode
      if (catalogApi) {
        try {
          const remoteProd = await catalogApi.getProductByBarcode(scannedSku);
          if (remoteProd) {
            if (remoteProd.currentStock <= 0) {
              handleOutOfStock(remoteProd, event);
              return;
            }
            handleProductMatched(remoteProd, event);
            return;
          }
        } catch (e) {
          console.error('[usePosKeyboardWedgeScanner] Remote barcode lookup failed:', e);
        }
      }

      addToast({
        title: language === 'th' ? 'ไม่พบบาร์โค้ด / SKU สินค้า' : 'Invalid Barcode / SKU',
        message:
          language === 'th'
            ? `ไม่พบสินค้าที่ตรงกับรหัส "${scannedSku}" ในระบบ POS`
            : `No matching product found for SKU/Barcode "${scannedSku}"`,
        type: 'warning',
      });
    },
    [catalogApi, addToast, language, handleOutOfStock, handleProductMatched]
  );

  // Initialize and maintain keyboard wedge scanner instance
  useEffect(() => {
    const scanner = createKeyboardWedgeScanner({
      products,
      enabled,
      maxIntervalMs,
      minLength,
      terminatorKeys,
      prefix,
      preventDefault,
      captureInInputs,
      filterValidSkus: true,
      onProductMatched: handleProductMatched,
      onOutOfStock: handleOutOfStock,
      onInvalidSku: handleInvalidSku,
    });

    scannerInstanceRef.current = scanner;

    return () => {
      scanner.destroy();
      scannerInstanceRef.current = null;
      if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
      if (indicatorTimeoutRef.current) clearTimeout(indicatorTimeoutRef.current);
    };
  }, [
    enabled,
    maxIntervalMs,
    minLength,
    terminatorKeys,
    prefix,
    preventDefault,
    captureInInputs,
    handleProductMatched,
    handleOutOfStock,
    handleInvalidSku,
  ]);

  // Keep catalog products synchronized inside scanner instance
  useEffect(() => {
    if (scannerInstanceRef.current) {
      scannerInstanceRef.current.setProducts(products);
    }
  }, [products]);

  const simulateScan = useCallback((barcodeOrSku: string) => {
    if (scannerInstanceRef.current) {
      scannerInstanceRef.current.simulateScan(barcodeOrSku);
    }
  }, []);

  const clearLastScan = useCallback(() => {
    setLastScannedBarcode(null);
    setLastScannedProduct(null);
    setLastScannedAt(null);
  }, []);

  return {
    lastScannedBarcode,
    lastScannedProduct,
    lastScannedAt,
    scanCount,
    isScanning,
    isFlashActive,
    activeIndicator,
    simulateScan,
    clearLastScan,
  };
}
