import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Building2,
  Palette,
  Printer,
  Receipt,
  ShieldCheck,
  Database,
  ChevronRight,
  ChevronDown,
  Settings as SettingsIcon,
  Sparkles,
  Wifi,
  WifiOff,
  User,
  Sliders,
  Layers,
  Sun,
  Moon,
  Monitor,
  Keyboard,
  UserCheck,
  Wrench,
  Crown,
  ReceiptText,
  Search,
  MoveHorizontal,
  Smartphone,
  Activity,
  Download,
  Check,
  X,
  Zap,
  Lock,
  KeyRound,
} from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { useBreadcrumb, BreadcrumbLevel } from '../../context/BreadcrumbContext';
import { useOffline } from '../../context/OfflineContext';
import { useToast } from '../../context/ToastContext';
import { useTheme } from '../../context/ThemeContext';
import { Badge } from '../../components/common/Badge';
import { Button } from '../../components/common/Button';
import { GraphicIcon, GraphicIconColor } from '../../components/common/GraphicIcon';
import { RbacGuard, useRbac } from '../../components/auth/RbacGuard';

import {
  SettingsTabId,
  SettingsTabItem,
  StoreProfileFormState,
  TaxAccountingFormState,
  SecurityPoliciesState,
  CustomerDisplayConfigState,
  SystemModuleConfig,
  QuickKeyItem,
  PaymentMethodItem,
  DiscountPresetItem,
  TaxBracketItem,
  LoyaltyEngineConfig,
  ReceiptTemplateConfig,
} from './types';

import {
  DEFAULT_MODULES_CONFIG,
  DEFAULT_QUICK_KEYS,
  DEFAULT_PAYMENT_METHODS,
  DEFAULT_DISCOUNT_PRESETS,
  DEFAULT_TAX_BRACKETS,
  DEFAULT_LOYALTY_CONFIG,
  DEFAULT_RECEIPT_TEMPLATE,
} from './defaultSettingsData';

import { GeneralSettingsTab } from './components/GeneralSettingsTab';
import { AppearanceSettingsTab } from './components/AppearanceSettingsTab';
import { HardwareSettingsTab } from './components/HardwareSettingsTab';
import { TaxAccountingSettingsTab } from './components/TaxAccountingSettingsTab';
import { SecurityRolesSettingsTab } from './components/SecurityRolesSettingsTab';
import { UserToRoleAssignmentTable } from './components/UserToRoleAssignmentTable';
import { PermissionSetsManagement } from './components/PermissionSetsManagement';
import { RoleManagementModule } from './components/RoleManagementModule';
import { DataSyncSettingsTab } from './components/DataSyncSettingsTab';
import { ModulesControlSettingsTab } from './components/ModulesControlSettingsTab';
import { SystemToolsManagementTab } from './components/SystemToolsManagementTab';
import { LoyaltyCrmSettingsTab } from './components/LoyaltyCrmSettingsTab';
import { AiAssistantSettingsTab } from './components/AiAssistantSettingsTab';
import { SystemConfigTab } from './components/SystemConfigTab';
import { StickyActionBar } from './components/StickyActionBar';
import { SettingsKeyboardShortcutsModal } from './components/SettingsKeyboardShortcutsModal';
import { SystemDiagnosticOverlay } from './components/SystemDiagnosticOverlay';
import { SystemHealthWidget } from './components/SystemHealthWidget';
import { SettingsMenuSelector } from './components/SettingsMenuSelector';
import { AdminResetPasswordModal } from './components/AdminResetPasswordModal';
import { AdminSecuritySettingsTab } from './components/AdminSecuritySettingsTab';
import { ManageRegisteredDevicesSection } from './components/ManageRegisteredDevicesSection';
import { isVerifiedSystemOwner, SYSTEM_OWNER_ADMIN_EMAIL } from '../../domain/auth';
import {
  resetSystemOwnerAdminPasswordInDatabase,
  ResetSystemOwnerPasswordResult,
} from '../../services/adminCredentialService';

const TAB_ITEMS: SettingsTabItem[] = [
  // 1. Store & POS Config
  {
    id: 'general',
    label: { th: 'ข้อมูลสาขาและใบเสร็จ', en: 'Store Identity & Receipt' },
    sublabel: { th: 'โปรไฟล์ร้าน, ภาษา, สกุลเงินหลัก, หัว/ท้ายบิล', en: 'Identity, language, currency, receipt header' },
    iconName: 'Building2',
    graphicColor: 'primary',
    category: 'store_pos',
    isQuickTab: true,
  },
  {
    id: 'appearance',
    label: { th: 'รูปลักษณ์และจอฝั่งลูกค้า (CFD)', en: 'Appearance & CFD' },
    sublabel: { th: 'ธีมองค์กร, โลโก้, จอแสดงผลฝั่งลูกค้า', en: 'Themes, branding, customer display' },
    iconName: 'Palette',
    graphicColor: 'cyan',
    category: 'store_pos',
    isQuickTab: true,
  },
  {
    id: 'tax_accounting',
    label: { th: 'การเงินและภาษี (VAT)', en: 'Tax & Accounting' },
    sublabel: { th: 'อัตราภาษี VAT, การคำนวณบิล, ช่องทางชำระ', en: 'VAT rate, tax inclusive/exclusive, payment channels' },
    iconName: 'ReceiptText',
    graphicColor: 'emerald',
    category: 'store_pos',
    isQuickTab: true,
  },
  {
    id: 'modules_control',
    label: { th: 'จัดการโมดูลทั้งระบบ (100%)', en: 'System Modules Control' },
    sublabel: { th: 'เปิด/ปิดทุกโมดูลและฟีเจอร์ย่อยในระบบ', en: 'Toggle modules & feature flags' },
    iconName: 'Sliders',
    graphicColor: 'primary',
    badge: 'ADVANCED',
    category: 'store_pos',
    isQuickTab: false,
  },

  {
    id: 'system_config',
    label: { th: 'การตั้งค่าองค์กรและสาขา', en: 'System Configuration' },
    sublabel: { th: 'จัดการองค์กร สาขา และเครื่อง POS', en: 'Manage org, branches, terminals' },
    iconName: 'Building2',
    graphicColor: 'primary',
    badge: 'CORE',
    category: 'store_pos',
    isQuickTab: true,
  },
  // 2. Hardware & Peripherals
  {
    id: 'hardware',
    label: { th: 'เครื่องพิมพ์และฮาร์ดแวร์', en: 'Printers & Peripherals' },
    sublabel: { th: 'เครื่องพิมพ์ใบเสร็จ, ลิ้นชักเก็บเงิน, เสียง', en: 'Thermal printer, cash drawer, sound' },
    iconName: 'Printer',
    graphicColor: 'amber',
    category: 'hardware_peripherals',
    isQuickTab: true,
  },
  {
    id: 'system_tools',
    label: { th: 'คอมโพเนนต์และปุ่มลัด', en: 'Component Tools Hub' },
    sublabel: { th: 'ปุ่มลัดสินค้า, ช่องทางชำระเงิน, ส่วนลด', en: 'Quick keys, payment tenders, discounts' },
    iconName: 'Wrench',
    graphicColor: 'indigo',
    badge: 'CRUD',
    category: 'hardware_peripherals',
    isQuickTab: true,
  },

  // 3. Loyalty & CRM
  {
    id: 'loyalty_crm',
    label: { th: 'สมาชิกและ VIP Tiers', en: 'Loyalty CRM & VIP' },
    sublabel: { th: 'คำนวณแต้มสะสม, สิทธิ์ส่วนลดระดับขั้น', en: 'Points calculation & tier privileges' },
    iconName: 'Crown',
    graphicColor: 'purple',
    badge: 'CRM',
    category: 'loyalty_crm',
    isQuickTab: true,
  },

  // 4. Security & System Admin
  {
    id: 'admin_security',
    label: { th: 'ความปลอดภัยผู้ดูแลระบบ (Admin Security)', en: 'Admin Security' },
    sublabel: {
      th: 'เปลี่ยนรหัสผ่าน Admin, ยืนยันตัวตนซ้ำ, ตรวจสอบแฮช SHA-256',
      en: 'Change Admin Password, re-authentication & hash check',
    },
    iconName: 'KeyRound',
    graphicColor: 'amber',
    badge: 'OWNER',
    category: 'security_admin',
    isQuickTab: true,
  },
  {
    id: 'security_roles',
    label: { th: 'ความปลอดภัยและนโยบาย', en: 'Security & PIN Governance' },
    sublabel: { th: 'รหัส PIN, พักหน้าจออัตโนมัติ, การอนุมัติคำสั่ง', en: 'PIN codes, auto-lock timeout, authorizations' },
    iconName: 'ShieldCheck',
    graphicColor: 'rose',
    category: 'security_admin',
    isQuickTab: true,
  },
  {
    id: 'role_management',
    label: { th: 'จัดการบทบาทและสิทธิ์ (RBAC)', en: 'Role & Permission Matrix' },
    sublabel: { th: 'ตารางสิทธิ์พนักงาน, จัดการสิทธิ์แอดมิน/แคชเชียร์', en: 'Role permissions matrix & staff assignments' },
    iconName: 'ShieldCheck',
    graphicColor: 'blue',
    badge: 'RBAC',
    category: 'security_admin',
    isQuickTab: true,
  },
  {
    id: 'role_assignment',
    label: { th: 'มอบหมายตำแหน่งพนักงาน', en: 'Staff Role Assignments' },
    sublabel: { th: 'ตารางมอบหมายตำแหน่งพนักงานและสาขา', en: 'User-to-role assignment table' },
    iconName: 'UserCheck',
    graphicColor: 'blue',
    badge: 'ADVANCED',
    category: 'security_admin',
    isQuickTab: false,
  },
  {
    id: 'permission_sets',
    label: { th: 'ชุดสิทธิ์พนักงานกำหนดเอง', en: 'Custom Permission Sets' },
    sublabel: { th: 'สร้างชุดสิทธิ์เฉพาะทาง, sandbox ทดสอบสิทธิ์', en: 'Custom role profiles & access sandbox' },
    iconName: 'Layers',
    graphicColor: 'purple',
    badge: 'ADVANCED',
    category: 'security_admin',
    isQuickTab: false,
  },
  {
    id: 'ai_assistant',
    label: { th: 'ผู้ช่วย PRODX AI', en: 'PRODX AI Assistant' },
    sublabel: { th: 'ตั้งค่า Gemini provider และทดสอบ PRODX AI', en: 'PRODX AI / Gemini Provider & Connection' },
    iconName: 'Sparkles',
    graphicColor: 'indigo',
    badge: 'AI',
    category: 'security_admin',
    isQuickTab: true,
  },
  {
    id: 'data_sync',
    label: { th: 'การซิงค์และสำรองข้อมูล', en: 'Offline Data Sync & Cache' },
    sublabel: { th: 'คิวซิงค์ Outbox, แคช IndexedDB, สำรองระบบ', en: 'Outbox queue, local storage, backup' },
    iconName: 'Database',
    graphicColor: 'slate',
    category: 'security_admin',
    isQuickTab: true,
  },
];

interface SettingsCategoryGroup {
  id: 'store_pos' | 'hardware_peripherals' | 'loyalty_crm' | 'security_admin';
  label: { th: string; en: string };
  iconName: string;
}

const CATEGORIES: SettingsCategoryGroup[] = [
  {
    id: 'store_pos',
    label: { th: '1. ร้านค้าและหน้าขาย', en: '1. Store & POS' },
    iconName: 'Building2',
  },
  {
    id: 'hardware_peripherals',
    label: { th: '2. อุปกรณ์และฮาร์ดแวร์', en: '2. Hardware & Peripherals' },
    iconName: 'Printer',
  },
  {
    id: 'loyalty_crm',
    label: { th: '3. สมาชิกและโปรโมชัน', en: '3. Loyalty & CRM' },
    iconName: 'Crown',
  },
  {
    id: 'security_admin',
    label: { th: '4. ความปลอดภัยและระบบ', en: '4. Security & Admin' },
    iconName: 'ShieldCheck',
  },
];

export const SettingsScreen: React.FC = () => {
  const { language } = useLanguage();
  const { session, updateStoreProfile, staffUsers, rolePermissions } = useAuth();
  const { isAdmin, canAccessSettingsTab } = useRbac();
  const { isOnline, outbox } = useOffline();
  const { addToast } = useToast();
  const { setSubLevels } = useBreadcrumb();
  const {
    themeMode,
    setThemeMode,
    activePresetId,
    currentPreset,
    customAccentColor,
    customLogo,
  } = useTheme();

  const [showDailyExportBanner, setShowDailyExportBanner] = useState<boolean>(() => {
    const today = new Date().toISOString().slice(0, 10);
    const lastExport = localStorage.getItem('prodx_last_settings_export_date');
    return lastExport !== today;
  });
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const handleExportSettingsJson = () => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const exportData = {
        exportType: 'PRODX_SETTINGS_ENTERPRISE_BACKUP',
        exportVersion: '2.4.0',
        exportedAt: new Date().toISOString(),
        store: session?.currentStore || null,
        storeProfile: storeForm,
        taxAccounting: taxForm,
        securityPolicies,
        cfdConfig,
        userRoleMappings: staffUsers.map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          employeeCode: u.employeeCode,
          role: u.role,
          isActive: u.isActive,
          roleAssignmentNote: u.roleAssignmentNote,
        })),
        rolePermissions,
        themeConfigurations: {
          themeMode,
          activePresetId,
          currentPreset,
          customAccentColor,
          customLogo,
        },
        systemModules: modulesConfig,
        quickKeys,
        paymentMethods,
        discountPresets,
        taxBrackets,
        loyaltyConfig,
        receiptTemplate,
      };

      const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(exportData, null, 2));
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute('href', dataStr);
      downloadAnchor.setAttribute('download', `prodx_settings_backup_${today}.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();

      localStorage.setItem('prodx_last_settings_export_date', today);
      setShowDailyExportBanner(false);

      addToast({
        title: language === 'th' ? 'สำรองข้อมูลการตั้งค่าสำเร็จ' : 'Settings Export Complete',
        message: language === 'th' ? 'ดาวน์โหลดไฟล์ JSON (ผู้ใช้, บทบาท, ธีม, การตั้งค่า) เรียบร้อยแล้ว' : 'User-to-role mappings and theme configurations exported successfully.',
        type: 'success',
      });
    } catch (e) {
      addToast({
        title: language === 'th' ? 'สำรองข้อมูลไม่สำเร็จ' : 'Export Failed',
        message: String(e),
        type: 'error',
      });
    }
  };

  const handleDismissDailyExport = () => {
    const today = new Date().toISOString().slice(0, 10);
    localStorage.setItem('prodx_last_settings_export_date', today);
    setShowDailyExportBanner(false);
  };

  const clearThemeLocalStorageAndReset = useCallback(() => {
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem('prodx_pos_theme_preset');
        window.localStorage.removeItem('prodx_custom_accent_color');

        const configStr = window.localStorage.getItem('PRODX_STORE_CONFIG_STATE');
        if (configStr) {
          try {
            const config = JSON.parse(configStr);
            if (config.theme) {
              config.theme.presetId = 'enterprise_obsidian';
              config.theme.mode = 'system';
            }
            if (config.branding) {
              config.branding.customAccentColor = null;
              config.branding.customLogo = null;
            }
            window.localStorage.setItem('PRODX_STORE_CONFIG_STATE', JSON.stringify(config));
          } catch {
            // ignore
          }
        }
      }
      window.location.reload();
    } catch (e) {
      console.error('[SettingsScreen] Failed to clear theme keys from localStorage:', e);
    }
  }, []);

  const [activeTab, setActiveTab] = useState<SettingsTabId>(() => {
    const savedTargetTab = localStorage.getItem('prodx_pos_settings_tab') as SettingsTabId | null;
    if (savedTargetTab) {
      localStorage.removeItem('prodx_pos_settings_tab');
      return savedTargetTab;
    }
    return 'general';
  });
  const [isSaving, setIsSaving] = useState(false);
  const [isShortcutsModalOpen, setIsShortcutsModalOpen] = useState(false);
  const [isDiagnosticOverlayOpen, setIsDiagnosticOverlayOpen] = useState(false);
  const [isAdminResetPasswordModalOpen, setIsAdminResetPasswordModalOpen] = useState(false);
  const [navSearchQuery, setNavSearchQuery] = useState('');

  /**
   * Secure Reset Password function for the System Owner Administrator ('kamkokaewthodsawat@gmail.com').
   * Enforces mandatory re-authentication (current password or WebAuthn biometrics) and updates
   * the hardcoded admin credentials in the Firestore database and local authentication store.
   */
  const handleAdminResetPassword = useCallback(
    async (params: {
      currentPassword?: string;
      biometricVerified?: boolean;
      newPassword: string;
    }): Promise<ResetSystemOwnerPasswordResult> => {
      const actor = session?.currentUser;
      if (!actor || !isVerifiedSystemOwner(actor)) {
        const denyMsg =
          language === 'th'
            ? `ปฏิเสธการเข้าถึง: อนุญาตเฉพาะเจ้าของระบบ (${SYSTEM_OWNER_ADMIN_EMAIL}) เท่านั้น`
            : `Access Denied: Only the verified System Owner (${SYSTEM_OWNER_ADMIN_EMAIL}) can update admin credentials.`;
        addToast({
          title: language === 'th' ? 'ไม่มีสิทธิ์ดำเนินการ' : 'Unauthorized Operation',
          message: denyMsg,
          type: 'error',
        });
        return { success: false, error: denyMsg };
      }

      const result = await resetSystemOwnerAdminPasswordInDatabase({
        actor,
        currentPassword: params.currentPassword,
        biometricVerified: params.biometricVerified,
        newPassword: params.newPassword,
        orgId: session?.organization.id,
        branchId: session?.currentStore.code,
      });

      if (!result.success) {
        addToast({
          title:
            language === 'th'
              ? 'รีเซ็ตรหัสผ่านผู้ดูแลระบบไม่สำเร็จ'
              : 'Admin Password Reset Failed',
          message:
            result.error ||
            (language === 'th'
              ? 'การยืนยันตัวตนซ้ำไม่ผ่านหรือไม่สามารถอัปเดตฐานข้อมูลได้'
              : 'Re-authentication failed or database update was rejected.'),
          type: 'error',
        });
        return result;
      }

      addToast({
        title:
          language === 'th'
            ? 'อัปเดตรหัสผ่านผู้ดูแลระบบสำเร็จ'
            : 'System Owner Admin Password Updated',
        message:
          language === 'th'
            ? `อัปเดตข้อมูลรหัสผ่านของ ${SYSTEM_OWNER_ADMIN_EMAIL} ลงในฐานข้อมูลเรียบร้อยแล้ว (v${result.version})`
            : `Updated hardcoded admin credentials for ${SYSTEM_OWNER_ADMIN_EMAIL} in database (v${result.version}).`,
        type: 'success',
      });

      return result;
    },
    [session, language, addToast],
  );
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [settingsMode, setSettingsMode] = useState<'quick' | 'advanced'>(() => {
    const saved = localStorage.getItem('prodx_settings_mode') as 'quick' | 'advanced' | null;
    if (saved) return saved;
    return session?.currentUser?.role === 'admin' ? 'advanced' : 'quick';
  });

  const handleToggleSettingsMode = (mode: 'quick' | 'advanced') => {
    setSettingsMode(mode);
    localStorage.setItem('prodx_settings_mode', mode);
    addToast({
      title: mode === 'quick'
        ? (language === 'th' ? 'โหมดตั้งค่าด่วน (Quick Mode)' : 'Quick Mode Active')
        : (language === 'th' ? 'โหมดตั้งค่าขั้นสูง (Advanced Admin Mode)' : 'Advanced Admin Mode Active'),
      message: mode === 'quick'
        ? (language === 'th' ? 'แสดงเฉพาะหัวข้อหลักที่ใช้งานบ่อย ลดความสับสน' : 'Showing essential core settings for quick configuration.')
        : (language === 'th' ? 'แสดงเมนูและเครื่องมือเทคนิคทั้งหมด 100%' : 'Showing 100% full system controls and technical tools.'),
      type: 'info',
    });
  };

  // Synchronize Settings navigation depth with global breadcrumbs
  useEffect(() => {
    const currentTabItem = TAB_ITEMS.find((t) => t.id === activeTab);
    const levels: BreadcrumbLevel[] = [];

    if (currentTabItem) {
      const catObj = CATEGORIES.find((c) => c.id === currentTabItem.category);
      if (catObj) {
        levels.push({
          id: `settings-cat-${catObj.id}`,
          label: catObj.label,
          onClick: () => setCategoryFilter(catObj.id),
        });
      }

      levels.push({
        id: `settings-tab-${currentTabItem.id}`,
        label: currentTabItem.label,
        onClick: () => setActiveTab(currentTabItem.id),
      });
    }

    setSubLevels(levels);
  }, [activeTab, setSubLevels]);

  const isMac = typeof window !== 'undefined' && /(Mac|iPhone|iPod|iPad)/i.test(navigator.platform || navigator.userAgent);

  // -------------------------------------------------------------
  // Dynamic State for Tools, Modules, Loyalty
  // -------------------------------------------------------------
  const [modulesConfig, setModulesConfig] = useState<SystemModuleConfig[]>(() => {
    const saved = localStorage.getItem('prodx_pos_modules_config');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {}
    }
    return DEFAULT_MODULES_CONFIG;
  });

  const [quickKeys, setQuickKeys] = useState<QuickKeyItem[]>(() => {
    const saved = localStorage.getItem('prodx_pos_quick_keys');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {}
    }
    return DEFAULT_QUICK_KEYS;
  });

  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodItem[]>(() => {
    const saved = localStorage.getItem('prodx_pos_payment_methods');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {}
    }
    return DEFAULT_PAYMENT_METHODS;
  });

  const [discountPresets, setDiscountPresets] = useState<DiscountPresetItem[]>(() => {
    const saved = localStorage.getItem('prodx_pos_discount_presets');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {}
    }
    return DEFAULT_DISCOUNT_PRESETS;
  });

  const [taxBrackets, setTaxBrackets] = useState<TaxBracketItem[]>(() => {
    const saved = localStorage.getItem('prodx_pos_tax_brackets');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {}
    }
    return DEFAULT_TAX_BRACKETS;
  });

  const [loyaltyConfig, setLoyaltyConfig] = useState<LoyaltyEngineConfig>(() => {
    const saved = localStorage.getItem('prodx_pos_loyalty_config');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {}
    }
    return DEFAULT_LOYALTY_CONFIG;
  });

  const [receiptTemplate, setReceiptTemplate] = useState<ReceiptTemplateConfig>(() => {
    const saved = localStorage.getItem('prodx_pos_receipt_template');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {}
    }
    return DEFAULT_RECEIPT_TEMPLATE;
  });

  // Auto-persist Tools & Modules changes
  const handleUpdateModules = (updated: SystemModuleConfig[]) => {
    setModulesConfig(updated);
    localStorage.setItem('prodx_pos_modules_config', JSON.stringify(updated));
  };

  const handleResetModules = () => {
    setModulesConfig(DEFAULT_MODULES_CONFIG);
    localStorage.setItem('prodx_pos_modules_config', JSON.stringify(DEFAULT_MODULES_CONFIG));
    addToast({
      title: language === 'th' ? 'คืนค่าเริ่มต้นโมดูล' : 'Modules Reset',
      message: language === 'th' ? 'รีเซ็ตการตั้งค่าโมดูลทั้งหมดเป็นค่าเริ่มต้น' : 'Reset all module parameters.',
      type: 'info',
    });
  };

  const handleUpdateQuickKeys = (keys: QuickKeyItem[]) => {
    setQuickKeys(keys);
    localStorage.setItem('prodx_pos_quick_keys', JSON.stringify(keys));
  };

  const handleUpdatePaymentMethods = (methods: PaymentMethodItem[]) => {
    setPaymentMethods(methods);
    localStorage.setItem('prodx_pos_payment_methods', JSON.stringify(methods));
  };

  const handleUpdateDiscountPresets = (presets: DiscountPresetItem[]) => {
    setDiscountPresets(presets);
    localStorage.setItem('prodx_pos_discount_presets', JSON.stringify(presets));
  };

  const handleUpdateTaxBrackets = (brackets: TaxBracketItem[]) => {
    setTaxBrackets(brackets);
    localStorage.setItem('prodx_pos_tax_brackets', JSON.stringify(brackets));
  };

  const handleUpdateLoyaltyConfig = (cfg: LoyaltyEngineConfig) => {
    setLoyaltyConfig(cfg);
    localStorage.setItem('prodx_pos_loyalty_config', JSON.stringify(cfg));
  };

  const handleUpdateReceiptTemplate = (tmpl: ReceiptTemplateConfig) => {
    setReceiptTemplate(tmpl);
    localStorage.setItem('prodx_pos_receipt_template', JSON.stringify(tmpl));
  };

  // Swipe navigation toggle and touch handler
  const [enableSwipeNavigation, setEnableSwipeNavigation] = useState<boolean>(() => {
    const saved = localStorage.getItem('prodx_pos_settings_swipe_nav');
    return saved === 'true';
  });

  const handleToggleSwipeNavigation = (enabled: boolean) => {
    setEnableSwipeNavigation(enabled);
    localStorage.setItem('prodx_pos_settings_swipe_nav', String(enabled));
    addToast({
      title: enabled
        ? (language === 'th' ? 'เปิดใช้งานสไลด์เปลี่ยนแท็บแล้ว' : 'Swipe Tab Navigation Enabled')
        : (language === 'th' ? 'ปิดใช้งานสไลด์เปลี่ยนแท็บแล้ว' : 'Swipe Tab Navigation Disabled'),
      message: enabled
        ? (language === 'th' ? 'คุณสามารถปัดหน้าจอด้านข้างเพื่อสลับแท็บเมนู' : 'You can now swipe left or right to cycle through settings.')
        : (language === 'th' ? 'ปิดระบบปัดหน้าจอแล้ว ป้องกันการสลับแท็บโดยไม่ตั้งใจ' : 'Swipe navigation disabled to prevent accidental tab switches.'),
      type: 'info',
    });
  };

  const tabIds = useMemo(() => TAB_ITEMS.map((t) => t.id), []);
  const [touchStartX, setTouchStartX] = useState(0);
  const [touchStartY, setTouchStartY] = useState(0);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (!enableSwipeNavigation) return;
    setTouchStartX(e.touches[0].clientX);
    setTouchStartY(e.touches[0].clientY);
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!enableSwipeNavigation) return;
    const diffX = e.changedTouches[0].clientX - touchStartX;
    const diffY = e.changedTouches[0].clientY - touchStartY;

    if (Math.abs(diffX) > 70 && Math.abs(diffX) > Math.abs(diffY) * 1.5) {
      const currentIndex = tabIds.indexOf(activeTab);
      if (diffX < 0 && currentIndex < tabIds.length - 1) {
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          navigator.vibrate(30);
        }
        setActiveTab(tabIds[currentIndex + 1]);
      } else if (diffX > 0 && currentIndex > 0) {
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          navigator.vibrate(30);
        }
        setActiveTab(tabIds[currentIndex - 1]);
      }
    }
  };

  const tabButtonRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    const handleOpenTab = (e: CustomEvent<{ tab: SettingsTabId }>) => {
      if (e.detail?.tab) {
        setActiveTab(e.detail.tab);
      }
    };
    window.addEventListener('prodx:open-settings-tab' as any, handleOpenTab);
    return () => {
      window.removeEventListener('prodx:open-settings-tab' as any, handleOpenTab);
    };
  }, []);

  // 1. Store Profile Draft State
  const initialStoreState = useMemo<StoreProfileFormState>(() => {
    return {
      storeName: session?.currentStore.name || 'PRODX Flagship Store',
      storeCode: session?.currentStore.code || 'BKK-01',
      storeAddress: session?.currentStore.address || '999/9 Rama I Road, Pathumwan, Bangkok 10330',
      storePhone: session?.currentStore.phone || '02-123-4567',
      timezone: session?.currentStore.timezone || 'Asia/Bangkok',
      baseCurrency: session?.currentStore.currency || 'THB',
      taxId: localStorage.getItem('prodx_pos_tax_id') || '0105559012345',
      branchName: localStorage.getItem('prodx_pos_branch_name') || 'สาขาหลัก (Headquarters)',
      receiptHeaderMsg: localStorage.getItem('prodx_pos_receipt_header_msg') || 'ยินดีต้อนรับสู่ PRODX Store',
      receiptFooterMsg: localStorage.getItem('prodx_pos_receipt_footer_msg') || 'ขอบคุณที่ใช้บริการ / สินค้าซื้อแล้วไม่รับเปลี่ยนคืน',
      promptPayId: localStorage.getItem('prodx_pos_promptpay_id') || '0812345678',
      terminalId: localStorage.getItem('prodx_pos_terminal_id') || 'TRM-EDC-01',
    };
  }, [session?.currentStore]);

  const [storeForm, setStoreForm] = useState<StoreProfileFormState>(initialStoreState);

  // 2. Tax & Accounting Draft State
  const initialTaxState = useMemo<TaxAccountingFormState>(() => {
    const savedVat = localStorage.getItem('prodx_pos_tax_rate_bps');
    const savedType = localStorage.getItem('prodx_pos_tax_type') as 'inclusive' | 'exclusive';
    const savedCash = localStorage.getItem('prodx_pos_pay_cash');
    const savedCard = localStorage.getItem('prodx_pos_pay_card');
    const savedPromptPay = localStorage.getItem('prodx_pos_pay_promptpay');
    const savedSplit = localStorage.getItem('prodx_pos_pay_split');

    return {
      defaultTaxRateBps: savedVat ? Number(savedVat) : (session?.currentStore.defaultTaxRateBps ?? 700),
      taxCalculationType: savedType || 'inclusive',
      taxId: localStorage.getItem('prodx_pos_tax_id') || '0105559012345',
      posMachineId: localStorage.getItem('prodx_pos_pos_machine_id') || 'REG-BKK-001',
      enableCash: savedCash !== 'false',
      enableCard: savedCard !== 'false',
      enablePromptPay: savedPromptPay !== 'false',
      enableSplitPayment: savedSplit !== 'false',
    };
  }, [session?.currentStore]);

  const [taxForm, setTaxForm] = useState<TaxAccountingFormState>(initialTaxState);

  // 3. Customer Display (CFD) State
  const initialCfdState = useMemo<CustomerDisplayConfigState>(() => {
    const saved = localStorage.getItem('prodx_pos_cfd_config');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {}
    }
    return {
      enabled: true,
      welcomeMessage: 'ยินดีต้อนรับสู่ PRODX Store',
      subMessage: 'สัมผัสประสบการณ์ช้อปปิ้งพรีเมียมด้วยระบบอัตโนมัติ',
      bannerImageUrl: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=1000&q=80',
      autoSlideshow: true,
      slideshowIntervalSeconds: 8,
      showCartLive: true,
      showQrPaymentPrompt: true,
    };
  }, []);

  const [cfdConfig, setCfdConfig] = useState<CustomerDisplayConfigState>(initialCfdState);

  // 4. Security Policies State
  const initialSecurityState = useMemo<SecurityPoliciesState>(() => {
    const saved = localStorage.getItem('prodx_pos_security_policies');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {}
    }
    return {
      inactivityTimeoutMinutes: 5,
      requirePinForVoid: true,
      requirePinForDiscount: true,
      requirePinForDrawerKick: true,
      requirePinForPriceOverride: true,
      allowCashierRefund: false,
      maxDiscountWithoutApproval: 15,
      maxRefundAmountWithoutApproval: 2000,
      auditRetentionDays: 90,
      enableBiometricUnlock: false,
    };
  }, []);

  const [securityPolicies, setSecurityPolicies] = useState<SecurityPoliciesState>(initialSecurityState);

  useEffect(() => {
    setStoreForm(initialStoreState);
  }, [initialStoreState]);

  useEffect(() => {
    setTaxForm(initialTaxState);
  }, [initialTaxState]);

  // Dirty State Calculation
  const isStoreDirty = useMemo(() => {
    return JSON.stringify(storeForm) !== JSON.stringify(initialStoreState);
  }, [storeForm, initialStoreState]);

  const isTaxDirty = useMemo(() => {
    return JSON.stringify(taxForm) !== JSON.stringify(initialTaxState);
  }, [taxForm, initialTaxState]);

  const isCfdDirty = useMemo(() => {
    return JSON.stringify(cfdConfig) !== JSON.stringify(initialCfdState);
  }, [cfdConfig, initialCfdState]);

  const isSecurityDirty = useMemo(() => {
    return JSON.stringify(securityPolicies) !== JSON.stringify(initialSecurityState);
  }, [securityPolicies, initialSecurityState]);

  const isDirty = isStoreDirty || isTaxDirty || isCfdDirty || isSecurityDirty;

  const dirtyCount = useMemo(() => {
    let count = 0;
    if (isStoreDirty) count++;
    if (isTaxDirty) count++;
    if (isCfdDirty) count++;
    if (isSecurityDirty) count++;
    return count;
  }, [isStoreDirty, isTaxDirty, isCfdDirty, isSecurityDirty]);

  // Save Handlers
  const handleSaveAll = useCallback(async () => {
    setIsSaving(true);
    try {
      updateStoreProfile({
        name: storeForm.storeName,
        code: storeForm.storeCode,
        address: storeForm.storeAddress,
        phone: storeForm.storePhone,
        timezone: storeForm.timezone,
        currency: storeForm.baseCurrency,
        defaultTaxRateBps: taxForm.defaultTaxRateBps,
      });

      localStorage.setItem('prodx_pos_tax_id', storeForm.taxId);
      localStorage.setItem('prodx_pos_branch_name', storeForm.branchName);
      localStorage.setItem('prodx_pos_receipt_header_msg', storeForm.receiptHeaderMsg);
      localStorage.setItem('prodx_pos_receipt_footer_msg', storeForm.receiptFooterMsg);
      localStorage.setItem('prodx_pos_promptpay_id', storeForm.promptPayId);
      localStorage.setItem('prodx_pos_terminal_id', storeForm.terminalId);

      localStorage.setItem('prodx_pos_tax_rate_bps', String(taxForm.defaultTaxRateBps));
      localStorage.setItem('prodx_pos_tax_type', taxForm.taxCalculationType);
      localStorage.setItem('prodx_pos_pos_machine_id', taxForm.posMachineId);
      localStorage.setItem('prodx_pos_pay_cash', String(taxForm.enableCash));
      localStorage.setItem('prodx_pos_pay_card', String(taxForm.enableCard));
      localStorage.setItem('prodx_pos_pay_promptpay', String(taxForm.enablePromptPay));
      localStorage.setItem('prodx_pos_pay_split', String(taxForm.enableSplitPayment));

      localStorage.setItem('prodx_pos_cfd_config', JSON.stringify(cfdConfig));
      localStorage.setItem('prodx_pos_security_policies', JSON.stringify(securityPolicies));

      await new Promise((resolve) => setTimeout(resolve, 350));

      addToast({
        title: language === 'th' ? 'บันทึกการตั้งค่าเรียบร้อย' : 'Settings Saved Successfully',
        message: language === 'th'
          ? 'ข้อมูลการตั้งค่าทั้งหมดถูกนำไปใช้ในระบบเรียบร้อยแล้ว'
          : 'All enterprise configuration parameters have been committed.',
        type: 'success',
      });
    } catch (e) {
      addToast({
        title: language === 'th' ? 'บันทึกการตั้งค่าล้มเหลว' : 'Save Error',
        message: String(e),
        type: 'error',
      });
    } finally {
      setIsSaving(false);
    }
  }, [
    storeForm,
    taxForm,
    cfdConfig,
    securityPolicies,
    updateStoreProfile,
    addToast,
    language,
  ]);

  const handleDiscard = useCallback(() => {
    setStoreForm(initialStoreState);
    setTaxForm(initialTaxState);
    setCfdConfig(initialCfdState);
    setSecurityPolicies(initialSecurityState);
    addToast({
      title: language === 'th' ? 'ยกเลิกการแก้ไขแล้ว' : 'Changes Discarded',
      message: language === 'th' ? 'คืนค่าฟอร์มกลับเป็นข้อมูลเดิม' : 'Reverted all unsaved changes.',
      type: 'info',
    });
  }, [initialStoreState, initialTaxState, initialCfdState, initialSecurityState, addToast, language]);

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((isShortcutsModalOpen || isDiagnosticOverlayOpen) && e.key !== 'Escape') {
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (isDirty && !isSaving) {
          handleSaveAll();
        } else if (!isDirty) {
          addToast({
            title: language === 'th' ? 'ไม่มีการเปลี่ยนแปลง' : 'No Changes',
            message: language === 'th' ? 'ไม่มีข้อมูลที่ต้องบันทึก' : 'All settings are up to date.',
            type: 'info',
          });
        }
        return;
      }

      // Alt+D or Ctrl/Cmd+Shift+D for Diagnostics Overlay
      if (
        (e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'd') ||
        ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'd')
      ) {
        e.preventDefault();
        setIsDiagnosticOverlayOpen((prev) => !prev);
        return;
      }

      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        const num = parseInt(e.key, 10);
        if (num >= 1 && num <= TAB_ITEMS.length) {
          e.preventDefault();
          const targetTab = TAB_ITEMS[num - 1];
          setActiveTab(targetTab.id);
          tabButtonRefs.current[num - 1]?.focus();
          return;
        }

        if (e.key === '/' || e.key === '?') {
          e.preventDefault();
          setIsShortcutsModalOpen(true);
          return;
        }
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [isDirty, isSaving, handleSaveAll, isShortcutsModalOpen, isDiagnosticOverlayOpen, language, addToast]);

  const handleTabListKeyDown = (e: React.KeyboardEvent, index: number) => {
    let nextIndex = -1;
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowRight':
        e.preventDefault();
        nextIndex = (index + 1) % TAB_ITEMS.length;
        break;
      case 'ArrowUp':
      case 'ArrowLeft':
        e.preventDefault();
        nextIndex = (index - 1 + TAB_ITEMS.length) % TAB_ITEMS.length;
        break;
      case 'Home':
        e.preventDefault();
        nextIndex = 0;
        break;
      case 'End':
        e.preventDefault();
        nextIndex = TAB_ITEMS.length - 1;
        break;
      default:
        break;
    }

    if (nextIndex !== -1) {
      const nextTab = TAB_ITEMS[nextIndex];
      setActiveTab(nextTab.id);
      tabButtonRefs.current[nextIndex]?.focus();
    }
  };

  const currentTabDef = TAB_ITEMS.find((t) => t.id === activeTab) || TAB_ITEMS[0];

  const getLucideIcon = (name: string) => {
    switch (name) {
      case 'Building2':
        return Building2;
      case 'Sparkles':
        return Sparkles;
      case 'Sliders':
        return Sliders;
      case 'Wrench':
        return Wrench;
      case 'Crown':
        return Crown;
      case 'Palette':
        return Palette;
      case 'Printer':
        return Printer;
      case 'ReceiptText':
        return ReceiptText;
      case 'ShieldCheck':
        return ShieldCheck;
      case 'KeyRound':
        return KeyRound;
      case 'UserCheck':
        return UserCheck;
      case 'Layers':
        return Layers;
      case 'Database':
        return Database;
      default:
        return SettingsIcon;
    }
  };

  // Grouped & Filtered Navigation Items
  const filteredTabItems = useMemo(() => {
    return TAB_ITEMS.filter((tab) => {
      // In Quick Mode, hide non-quick tabs unless searching or user is Admin (Admin sees full org settings)
      if (settingsMode === 'quick' && !isAdmin && !navSearchQuery && !tab.isQuickTab) {
        return false;
      }

      const matchesCategory = categoryFilter === 'all' || tab.category === categoryFilter;
      if (!matchesCategory) return false;
      if (!navSearchQuery) return true;
      const query = navSearchQuery.toLowerCase();
      return (
        tab.label.th.toLowerCase().includes(query) ||
        tab.label.en.toLowerCase().includes(query) ||
        tab.sublabel.th.toLowerCase().includes(query) ||
        tab.sublabel.en.toLowerCase().includes(query)
      );
    });
  }, [categoryFilter, navSearchQuery, settingsMode, isAdmin]);

  return (
    <div
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      className="flex-1 flex flex-col min-h-0 overflow-y-auto p-4 sm:p-6 lg:p-8 space-y-6 bg-background text-text no-scrollbar select-none pb-32 sm:pb-28"
    >
      {/* Automated Daily Settings Export Reminder Banner */}
      {showDailyExportBanner && (
        <div className="bg-primary/10 border border-primary/30 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm animate-in fade-in duration-300">
          <div className="flex items-start sm:items-center gap-3">
            <div className="p-2 rounded-xl bg-primary text-primary-foreground shrink-0 mt-0.5 sm:mt-0">
              <Download className="h-5 w-5" />
            </div>
            <div>
              <h4 className="text-xs font-bold text-text uppercase tracking-wide">
                {language === 'th' ? 'แจ้งเตือนสำรองข้อมูลการตั้งค่าประจำวัน (Daily Settings Export Reminder)' : 'Daily Settings Backup Reminder'}
              </h4>
              <p className="text-[11px] text-text/70 mt-0.5">
                {language === 'th'
                  ? 'เพื่อความต่อเนื่องทางธุรกิจ (Business Continuity) กรุณาดาวน์โหลดไฟล์สำรองข้อมูลผู้ใช้ บทบาท และธีมประจำวัน'
                  : 'Export user-to-role mappings and theme configurations today to ensure business continuity and quick recovery.'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
            <Button
              variant="primary"
              size="sm"
              onClick={handleExportSettingsJson}
              className="gap-1.5 font-bold cursor-pointer"
            >
              <Download className="h-3.5 w-3.5" />
              {language === 'th' ? 'ดาวน์โหลด JSON ทันที' : 'Export JSON Now'}
            </Button>
            <button
              type="button"
              onClick={handleDismissDailyExport}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-text/60 hover:text-text hover:bg-background/80 transition-colors cursor-pointer"
            >
              {language === 'th' ? 'ปิดเตือนวันนี้' : 'Dismiss Today'}
            </button>
          </div>
        </div>
      )}

      {/* Top Header & Overview Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 sm:gap-6 pb-4 sm:pb-6 border-b border-border/50">
        <div className="flex items-center gap-3.5">
          <GraphicIcon
            icon={SettingsIcon}
            color="primary"
            variant="glow"
            size="lg"
          />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-heading-2 text-text">
                {language === 'th'
                  ? 'ศูนย์รวมการตั้งค่าและจัดการระบบ (Unified Enterprise Settings Hub)'
                  : 'Unified Enterprise Settings & Control Hub'}
              </h1>
              <Badge variant="primary" size="xs" className="font-mono">
                100% Managed
              </Badge>
            </div>
            <p className="text-caption text-text/70 mt-0.5">
              {language === 'th'
                ? 'จัดการพารามิเตอร์ โมดูล เครื่องมือ ปุ่มลัด อุปกรณ์ต่อพ่วง นโยบายความปลอดภัย และการซิงค์ข้อมูลครอบคลุมทั้งระบบ'
                : 'Centralized governance for all system modules, tools, quick keys, peripherals, and security.'}
            </p>
          </div>
        </div>

        {/* Status Badges & Theme Mode Switcher Toolbar */}
        <div className="flex flex-wrap items-center gap-2 self-stretch md:self-auto justify-start md:justify-end text-xs">
          {/* Quick / Advanced Complexity Mode Switcher */}
          <div
            className="h-9 p-1 rounded-xl border border-border/80 bg-card flex items-center gap-1 shadow-2xs"
            role="group"
            aria-label="Settings complexity mode"
          >
            <button
              type="button"
              onClick={() => handleToggleSettingsMode('quick')}
              title={language === 'th' ? 'โหมดด่วน: แสดงเฉพาะหัวข้อหลักที่ใช้บ่อย' : 'Quick Mode: Show essential settings'}
              className={`h-7 px-2.5 rounded-lg flex items-center gap-1.5 text-xs font-semibold transition-all cursor-pointer ${
                settingsMode === 'quick'
                  ? 'bg-primary text-primary-foreground shadow-xs font-bold'
                  : 'text-text/60 hover:text-text hover:bg-background/40'
              }`}
            >
              <Zap className="h-3.5 w-3.5" />
              <span>{language === 'th' ? 'ตั้งค่าด่วน' : 'Quick'}</span>
            </button>
            <button
              type="button"
              onClick={() => handleToggleSettingsMode('advanced')}
              title={language === 'th' ? 'โหมดขั้นสูง: แสดงทุกเครื่องมือและเมนู 100%' : 'Advanced Mode: Full 100% settings controls'}
              className={`h-7 px-2.5 rounded-lg flex items-center gap-1.5 text-xs font-semibold transition-all cursor-pointer ${
                settingsMode === 'advanced'
                  ? 'bg-primary text-primary-foreground shadow-xs font-bold'
                  : 'text-text/60 hover:text-text hover:bg-background/40'
              }`}
            >
              <Sliders className="h-3.5 w-3.5" />
              <span>{language === 'th' ? 'ขั้นสูง' : 'Advanced'}</span>
            </button>
          </div>

          {/* Swipe Tab Switcher Quick Toggle */}
          <button
            type="button"
            role="switch"
            aria-checked={enableSwipeNavigation}
            onClick={() => handleToggleSwipeNavigation(!enableSwipeNavigation)}
            title={
              enableSwipeNavigation
                ? (language === 'th' ? 'การสไลด์หน้าจอ: เปิดอยู่ (คลิกเพื่อปิด)' : 'Swipe Navigation: ON (click to disable)')
                : (language === 'th' ? 'การสไลด์หน้าจอ: ปิดอยู่ (คลิกเพื่อเปิด)' : 'Swipe Navigation: OFF (click to enable)')
            }
            className={`h-9 px-3 rounded-xl border flex items-center gap-2 text-xs font-semibold transition-all cursor-pointer shadow-2xs ${
              enableSwipeNavigation
                ? 'bg-primary/10 border-primary/40 text-primary font-bold'
                : 'border-border/80 bg-card text-text/70 hover:text-text hover:border-border'
            }`}
          >
            <MoveHorizontal className={`h-3.5 w-3.5 ${enableSwipeNavigation ? 'text-primary' : 'text-text/40'}`} />
            <span className="hidden sm:inline">
              {language === 'th' ? 'สไลด์หน้าจอ' : 'Swipe Tab'}
            </span>
            <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold ${
              enableSwipeNavigation ? 'bg-primary text-white' : 'bg-background border border-border text-text/50'
            }`}>
              {enableSwipeNavigation ? 'ON' : 'OFF'}
            </span>
          </button>

          {/* Keyboard Shortcuts Trigger Button */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setIsShortcutsModalOpen(true)}
            className="h-9 px-3 rounded-xl border-border/80 bg-card text-xs font-semibold hover:text-primary hover:border-primary/40 shadow-2xs"
            leftIcon={<Keyboard className="h-3.5 w-3.5 text-text/50" />}
            title={language === 'th' ? 'ดูคีย์ลัด (Alt+?)' : 'Keyboard Shortcuts (Alt+?)'}
          >
            <span className="hidden sm:inline">{language === 'th' ? 'คีย์ลัด' : 'Shortcuts'}</span>
            <kbd className="ml-1 px-1.5 py-0.5 text-[9px] font-mono bg-background border border-border rounded text-text/60 font-bold">Alt+?</kbd>
          </Button>

          {/* Light / Dark / System Mode Switcher */}
          <div
            className="h-9 p-1 rounded-xl border border-border/80 bg-card flex items-center gap-1 shadow-2xs"
            role="group"
            aria-label="Theme mode switcher"
          >
            <button
              type="button"
              onClick={() => {
                setThemeMode('light');
                addToast({
                  title: language === 'th' ? 'สลับโหมดสว่าง' : 'Light Mode Active',
                  message: language === 'th' ? 'เปลี่ยนการแสดงผลเป็นโหมดสว่าง (Light)' : 'Theme switched to Light mode.',
                  type: 'info',
                });
              }}
              title={language === 'th' ? 'โหมดสว่าง (Light)' : 'Light mode'}
              className={`h-7 px-2.5 rounded-lg flex items-center gap-1.5 text-xs font-semibold transition-all cursor-pointer select-none focus-visible:outline-hidden ${
                themeMode === 'light'
                  ? 'bg-background text-text border border-border/70 shadow-xs font-bold'
                  : 'text-text/60 hover:text-text hover:bg-background/40'
              }`}
            >
              <Sun className={`h-3.5 w-3.5 ${themeMode === 'light' ? 'text-amber-500' : 'text-text/50'}`} />
              <span className="hidden sm:inline text-[11px]">{language === 'th' ? 'สว่าง' : 'Light'}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setThemeMode('dark');
                addToast({
                  title: language === 'th' ? 'สลับโหมดมืด' : 'Dark Mode Active',
                  message: language === 'th' ? 'เปลี่ยนการแสดงผลเป็นโหมดมืด (Dark)' : 'Theme switched to Dark mode.',
                  type: 'info',
                });
              }}
              title={language === 'th' ? 'โหมดมืด (Dark)' : 'Dark mode'}
              className={`h-7 px-2.5 rounded-lg flex items-center gap-1.5 text-xs font-semibold transition-all cursor-pointer select-none focus-visible:outline-hidden ${
                themeMode === 'dark'
                  ? 'bg-background text-text border border-border/70 shadow-xs font-bold'
                  : 'text-text/60 hover:text-text hover:bg-background/40'
              }`}
            >
              <Moon className={`h-3.5 w-3.5 ${themeMode === 'dark' ? 'text-primary' : 'text-text/50'}`} />
              <span className="hidden sm:inline text-[11px]">{language === 'th' ? 'มืด' : 'Dark'}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setThemeMode('system');
                addToast({
                  title: language === 'th' ? 'สลับโหมดอัตโนมัติ (System)' : 'System Mode Active',
                  message: language === 'th'
                    ? 'ปรับเปลี่ยนโทนสีตามการตั้งค่าของระบบปฏิบัติการอัตโนมัติ'
                    : 'Theme automatically adapts to OS preferences.',
                  type: 'info',
                });
              }}
              title={language === 'th' ? 'ตามระบบอุปกรณ์ (System)' : 'Follow system OS theme'}
              className={`h-7 px-2.5 rounded-lg flex items-center gap-1.5 text-xs font-semibold transition-all cursor-pointer select-none focus-visible:outline-hidden ${
                themeMode === 'system'
                  ? 'bg-background text-text border border-border/70 shadow-xs font-bold'
                  : 'text-text/60 hover:text-text hover:bg-background/40'
              }`}
            >
              <Monitor className={`h-3.5 w-3.5 ${themeMode === 'system' ? 'text-primary' : 'text-text/50'}`} />
              <span className="hidden sm:inline text-[11px]">{language === 'th' ? 'ระบบ' : 'System'}</span>
            </button>
          </div>

          <div className="h-9 px-3 rounded-xl border border-border/80 bg-card flex items-center gap-2 text-text/70 shadow-2xs text-xs">
            <Building2 className="h-3.5 w-3.5 text-primary" />
            <span className="font-mono font-bold text-text">{session?.currentStore.code}</span>
          </div>

          <div className="h-9 px-3 rounded-xl border border-border/80 bg-card flex items-center gap-2 text-text/70 shadow-2xs text-xs">
            <User className="h-3.5 w-3.5 text-emerald-500" />
            <span className="font-semibold text-text">{session?.currentUser.name}</span>
            <span className="text-[10px] uppercase font-bold text-text/50">({session?.currentUser.role})</span>
          </div>

          {session?.currentUser.role === 'admin' && (
            <>
              <button
                type="button"
                id="settings-admin-security-tab-btn"
                onClick={() => setActiveTab('admin_security')}
                title={
                  language === 'th'
                    ? 'เปิดแท็บความปลอดภัยผู้ดูแลระบบและเปลี่ยนรหัสผ่าน Admin'
                    : 'Open Admin Security Tab & Change Admin Password'
                }
                className={`h-9 px-3 rounded-xl border flex items-center gap-1.5 text-xs font-bold transition-all cursor-pointer shadow-2xs active-scale whitespace-nowrap ${
                  activeTab === 'admin_security'
                    ? 'border-amber-500 bg-amber-500 text-slate-950'
                    : 'border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400'
                }`}
              >
                <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                <span>{language === 'th' ? 'Admin Security' : 'Admin Security'}</span>
              </button>

              <button
                type="button"
                id="settings-reset-admin-password-btn"
                onClick={() => setIsAdminResetPasswordModalOpen(true)}
                title={
                  language === 'th'
                    ? 'รีเซ็ตรหัสผ่านผู้ดูแลระบบสูงสุด (System Owner Re-Authentication)'
                    : 'Reset System Owner Admin Password (Requires Re-Authentication)'
                }
                className="h-9 px-3 rounded-xl border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center gap-1.5 text-xs font-bold transition-all cursor-pointer shadow-2xs active-scale whitespace-nowrap"
              >
                <KeyRound className="h-3.5 w-3.5 shrink-0" />
                <span>
                  {language === 'th' ? 'เปลี่ยนรหัสผ่าน Admin' : 'Change Admin Password'}
                </span>
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() => setIsDiagnosticOverlayOpen(true)}
            title={language === 'th' ? 'ศูนย์วินิจฉัยและสุขภาพระบบ (Alt+D)' : 'System Diagnostic & Health Telemetry (Alt+D)'}
            className="h-9 px-3 rounded-xl border border-primary/30 bg-primary/10 hover:bg-primary/20 text-primary flex items-center gap-2 text-xs font-bold transition-all cursor-pointer shadow-2xs active-scale"
          >
            <Activity className="h-3.5 w-3.5 animate-pulse" />
            <span className="hidden sm:inline">{language === 'th' ? 'วินิจฉัยระบบ' : 'Diagnostics'}</span>
            <span className="px-1.5 py-0.5 rounded bg-primary text-white text-[10px] font-mono font-bold">
              {isOnline ? 'HEALTH' : `${outbox.length} QUEUED`}
            </span>
          </button>

          <div
            onClick={() => setIsDiagnosticOverlayOpen(true)}
            title={language === 'th' ? 'คลิกเพื่อดูรายงานวินิจฉัยและสถานะซิงก์' : 'Click to inspect diagnostic & sync telemetry'}
            className="h-9 px-3 rounded-xl border border-border/80 bg-card hover:bg-card/80 flex items-center gap-2 shadow-2xs cursor-pointer transition active-scale text-xs"
          >
            {isOnline ? (
              <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-bold text-[11px]">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span>ONLINE</span>
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-rose-500 font-bold text-[11px]">
                <span className="w-2 h-2 rounded-full bg-rose-500" />
                <span>OFFLINE ({outbox.length})</span>
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Main Two-Column Master-Detail Layout */}
      <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] lg:grid-cols-[300px_1fr] gap-4 sm:gap-6 items-start">
        {/* Left Column: Categorized Navigation Sidebar */}
        <aside className="space-y-3 md:sticky md:top-4">
          <div className="flex items-center justify-between px-2 text-[11px] font-bold uppercase tracking-wider text-text/50">
            <span>{language === 'th' ? 'ศูนย์รวมหมวดหมู่การตั้งค่า' : 'Settings Categories'}</span>
            <span className="text-[10px] font-mono text-text/40 hidden md:inline">Alt+1..9</span>
          </div>

          {/* Modern Interactive Settings Navigation Selector Hub */}
          <SettingsMenuSelector
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            tabItems={filteredTabItems}
            categories={CATEGORIES}
            categoryFilter={categoryFilter}
            setCategoryFilter={setCategoryFilter}
            navSearchQuery={navSearchQuery}
            setNavSearchQuery={setNavSearchQuery}
            settingsMode={settingsMode}
            isStoreDirty={isStoreDirty}
            isCfdDirty={isCfdDirty}
            isTaxDirty={isTaxDirty}
            isSecurityDirty={isSecurityDirty}
            language={language}
          />

          {/* Desktop Categorized Navigation Sidebar */}
          <nav
            role="tablist"
            aria-orientation="vertical"
            aria-label={language === 'th' ? 'หมวดหมู่การตั้งค่า' : 'Settings Categories'}
            className="hidden md:flex bg-card border border-border border-crisp rounded-2xl p-2.5 shadow-xs flex-col gap-3"
          >
            {CATEGORIES.map((cat) => {
              const catTabs = filteredTabItems.filter((t) => t.category === cat.id);
              if (catTabs.length === 0) return null;
              const CatLucideIcon = getLucideIcon(cat.iconName);

              return (
                <div key={cat.id} className="space-y-1">
                  <div className="flex items-center justify-between px-2 pt-1 pb-1 text-[11px] font-bold uppercase tracking-wider text-text/60 border-t border-border/40 first:border-t-0 first:pt-0">
                    <div className="flex items-center gap-1.5">
                      <CatLucideIcon className="h-3.5 w-3.5 text-primary shrink-0" />
                      <span>{cat.label[language]}</span>
                    </div>
                    <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-background border border-border/60 text-text/50 font-semibold">
                      {catTabs.length}
                    </span>
                  </div>

                  <div className="space-y-1">
                    {catTabs.map((tab) => {
                      const globalIdx = TAB_ITEMS.findIndex((t) => t.id === tab.id);
                      const isActive = activeTab === tab.id;
                      const hasDirtyOnThisTab =
                        (tab.id === 'general' && isStoreDirty) ||
                        (tab.id === 'appearance' && isCfdDirty) ||
                        (tab.id === 'tax_accounting' && isTaxDirty) ||
                        (tab.id === 'security_roles' && isSecurityDirty);

                      const LucideComp = getLucideIcon(tab.iconName);

                      return (
                        <button
                          key={tab.id}
                          id={`settings-tab-${tab.id}`}
                          ref={(el) => {
                            tabButtonRefs.current[globalIdx] = el;
                          }}
                          role="tab"
                          aria-selected={isActive}
                          aria-controls={`settings-tabpanel-${tab.id}`}
                          tabIndex={isActive ? 0 : -1}
                          onKeyDown={(e) => handleTabListKeyDown(e, globalIdx)}
                          type="button"
                          onClick={() => setActiveTab(tab.id)}
                          className={`w-full text-left px-3 py-2.5 rounded-xl transition-all duration-150 flex items-center justify-between gap-2.5 cursor-pointer shrink-0 select-none focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary ${
                            isActive
                              ? 'bg-primary/10 border border-primary/40 text-primary shadow-xs font-bold'
                              : 'border border-transparent text-text/70 hover:text-text hover:bg-background/80'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <GraphicIcon
                              icon={LucideComp}
                              color={tab.graphicColor}
                              variant={isActive ? 'badge' : 'flat'}
                              size="sm"
                              animateHover={false}
                            />
                            <div className="min-w-0 text-left">
                              <div className={`text-xs truncate ${isActive ? 'font-black text-text' : 'font-bold'}`}>
                                {tab.label[language]}
                              </div>
                              <div className="text-[10px] truncate text-text/40 mt-0.5">
                                {tab.sublabel[language]}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            {!canAccessSettingsTab(tab.id) && (
                              <span
                                className="inline-flex shrink-0"
                                title={
                                  language === 'th'
                                    ? 'สงวนสิทธิ์เฉพาะ Admin ระดับองค์กร'
                                    : 'Organization Admin Only'
                                }
                              >
                                <Lock className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                              </span>
                            )}
                            {tab.badge && (
                              <Badge
                                variant={isActive ? 'primary' : 'neutral'}
                                size="sm"
                                className="text-[9px] px-1.5 py-0"
                              >
                                {tab.badge}
                              </Badge>
                            )}
                            {hasDirtyOnThisTab && (
                              <span
                                className="w-2 h-2 rounded-full bg-amber-500 animate-pulse ring-2 ring-amber-500/20"
                                title="Unsaved changes in this tab"
                              />
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </nav>
        </aside>

        {/* Right Column: Active Workspace Panel */}
        <main
          role="tabpanel"
          id={`settings-tabpanel-${activeTab}`}
          aria-labelledby={`settings-tab-${activeTab}`}
          tabIndex={0}
          className="space-y-4 min-w-0 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 rounded-2xl"
        >
          {/* Breadcrumbs Navigation */}
          <div className="flex items-center justify-between text-xs text-text/60 px-1">
            <div className="flex items-center gap-2">
              <span className="hover:text-text cursor-default">
                {language === 'th' ? 'การตั้งค่าระบบ' : 'Settings'}
              </span>
              <ChevronRight className="h-3.5 w-3.5 text-text/40" />
              <span className="font-bold text-primary">
                {currentTabDef.label[language]}
              </span>
            </div>
            <div className="hidden sm:flex items-center gap-2 text-[11px] text-text/40 font-mono">
              <span>{isMac ? '⌘S' : 'Ctrl+S'} = Save</span>
              <span>•</span>
              <span>Esc = Discard</span>
            </div>
          </div>

          {/* System Health Troubleshooting Widget */}
          <SystemHealthWidget />

          {/* Active Tab Component Render — Guarded by Granular Settings Tab RBAC Policy */}
          <div className="pb-28">
            <RbacGuard settingsTab={activeTab} hideMode="denied-card">
              {activeTab === 'system_config' && <SystemConfigTab />}
              {activeTab === 'general' && (
                <GeneralSettingsTab
                  formData={storeForm}
                  onChangeField={(field, val) =>
                    setStoreForm((prev) => ({ ...prev, [field]: val }))
                  }
                />
              )}

              {activeTab === 'ai_assistant' && <AiAssistantSettingsTab />}

              {activeTab === 'modules_control' && (
                <ModulesControlSettingsTab
                  modules={modulesConfig}
                  onUpdateModules={handleUpdateModules}
                  onResetModules={handleResetModules}
                />
              )}

              {activeTab === 'system_tools' && (
                <SystemToolsManagementTab
                  quickKeys={quickKeys}
                  onUpdateQuickKeys={handleUpdateQuickKeys}
                  paymentMethods={paymentMethods}
                  onUpdatePaymentMethods={handleUpdatePaymentMethods}
                  discountPresets={discountPresets}
                  onUpdateDiscountPresets={handleUpdateDiscountPresets}
                  taxBrackets={taxBrackets}
                  onUpdateTaxBrackets={handleUpdateTaxBrackets}
                  receiptTemplate={receiptTemplate}
                  onUpdateReceiptTemplate={handleUpdateReceiptTemplate}
                />
              )}

              {activeTab === 'loyalty_crm' && (
                <LoyaltyCrmSettingsTab
                  loyaltyConfig={loyaltyConfig}
                  onChangeConfig={handleUpdateLoyaltyConfig}
                />
              )}

              {activeTab === 'appearance' && (
                <AppearanceSettingsTab
                  cfdConfig={cfdConfig}
                  onChangeCfdField={(field, val) =>
                    setCfdConfig((prev) => ({ ...prev, [field]: val }))
                  }
                  onClearThemeLocalStorageAndReset={clearThemeLocalStorageAndReset}
                />
              )}

              {activeTab === 'hardware' && <HardwareSettingsTab />}

              {activeTab === 'tax_accounting' && (
                <TaxAccountingSettingsTab
                  formData={taxForm}
                  onChangeField={(field, val) =>
                    setTaxForm((prev) => ({ ...prev, [field]: val }))
                  }
                />
              )}

              {activeTab === 'admin_security' && (
                <AdminSecuritySettingsTab
                  onChangeAdminPassword={handleAdminResetPassword}
                  onOpenResetModal={() => setIsAdminResetPasswordModalOpen(true)}
                />
              )}

              {activeTab === 'security_roles' && (
                <SecurityRolesSettingsTab
                  policies={securityPolicies}
                  onChangePolicy={(field, val) =>
                    setSecurityPolicies((prev) => ({ ...prev, [field]: val }))
                  }
                  onOpenAdminPasswordReset={() => setIsAdminResetPasswordModalOpen(true)}
                />
              )}

              {activeTab === 'role_management' && <RoleManagementModule />}

              {activeTab === 'role_assignment' && <UserToRoleAssignmentTable />}

              {activeTab === 'permission_sets' && <PermissionSetsManagement />}

              {activeTab === 'data_sync' && <DataSyncSettingsTab />}
            </RbacGuard>

            {activeTab !== 'admin_security' && activeTab !== 'security_roles' && (
              <div className="mt-6">
                <ManageRegisteredDevicesSection />
              </div>
            )}
          </div>
        </main>
      </div>

      {/* Floating Sticky Action Bar for Dirty States */}
      <StickyActionBar
        isVisible={isDirty}
        isSaving={isSaving}
        onSave={handleSaveAll}
        onDiscard={handleDiscard}
        dirtyCount={dirtyCount}
        label={
          language === 'th'
            ? 'มีการปรับแต่งค่าในระบบที่ยังไม่ได้บันทึก'
            : 'You have uncommitted setting modifications.'
        }
      />

      {/* Keyboard Shortcuts Reference Modal */}
      {isShortcutsModalOpen && (
        <SettingsKeyboardShortcutsModal
          isOpen={isShortcutsModalOpen}
          onClose={() => setIsShortcutsModalOpen(false)}
        />
      )}

      {/* System Diagnostic & Health Telemetry Overlay */}
      {isDiagnosticOverlayOpen && (
        <SystemDiagnosticOverlay
          isOpen={isDiagnosticOverlayOpen}
          onClose={() => setIsDiagnosticOverlayOpen(false)}
        />
      )}

      {/* System Owner Admin Re-Authentication & Reset Password Modal */}
      {isAdminResetPasswordModalOpen && (
        <AdminResetPasswordModal
          isOpen={isAdminResetPasswordModalOpen}
          onClose={() => setIsAdminResetPasswordModalOpen(false)}
          onResetAdminPassword={handleAdminResetPassword}
        />
      )}
    </div>
  );
};
