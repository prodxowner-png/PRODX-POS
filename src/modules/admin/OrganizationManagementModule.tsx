import React, { useState, useEffect, useMemo } from 'react';
import {
  AlertTriangle,
  Building2,
  Check,
  CheckCircle2,
  ChevronRight,
  Copy,
  Edit,
  ExternalLink,
  Filter,
  Layers,
  Mail,
  Monitor,
  Phone,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Shield,
  Sliders,
  Store,
  Trash2,
  Wifi,
  X,
} from 'lucide-react';
import { Organization, Branch, Terminal } from '../settings/types';
import {
  getOrganizations,
  getBranches,
  getTerminals,
  createOrganization,
  updateOrganization,
  deleteOrganization,
  deleteOrganizationCascade,
  createBranch,
  updateBranch,
  deleteBranch,
  deleteBranchCascade,
  createTerminal,
  updateTerminal,
  deleteTerminal,
  subscribeToOrganizationStructure,
  CreateOrganizationInput,
  CreateBranchInput,
  CreateTerminalInput,
} from '../../services/organizationService';
import { useToast } from '../../context/ToastContext';
import { useLanguage } from '../../context/LanguageContext';
import { useConfirmation } from '../../context/ConfirmationDialogContext';
import { Button } from '../../components/common/Button';
import { AdminSyncStatusIndicator } from '../../components/admin/AdminSyncStatusIndicator';
import { OrganizationAuditLogTab } from './OrganizationAuditLogTab';
import {
  OrganizationFormDialog,
  BranchFormDialog,
  TerminalFormDialog,
  buildOrganizationDeleteConfirmation,
  buildBranchDeleteConfirmation,
  buildTerminalDeleteConfirmation,
} from './dialogs';

export interface OrganizationManagementModuleProps {
  initialTab?: 'overview' | 'organizations' | 'branches' | 'terminals' | 'audit';
  onNavigateSection?: (section: 'overview' | 'organizations' | 'branches' | 'terminals' | 'audit') => void;
}

type ViewMode = 'hierarchy' | 'tabbed';
type ActiveTab = 'organizations' | 'branches' | 'terminals' | 'audit';

export const OrganizationManagementModule: React.FC<OrganizationManagementModuleProps> = ({
  initialTab = 'organizations',
}) => {
  const { addToast } = useToast();
  const { language } = useLanguage();
  const { confirm } = useConfirmation();
  const isThai = language === 'th';

  // Navigation & View state
  const [activeTab, setActiveTab] = useState<ActiveTab>(
    initialTab === 'branches'
      ? 'branches'
      : initialTab === 'terminals'
      ? 'terminals'
      : initialTab === 'audit'
      ? 'audit'
      : 'organizations'
  );
  const [viewMode, setViewMode] = useState<ViewMode>('tabbed');
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Data state
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [terminals, setTerminals] = useState<Terminal[]>([]);

  // Selected Scope Filters
  const [selectedOrgId, setSelectedOrgId] = useState<string>('');
  const [selectedBranchId, setSelectedBranchId] = useState<string>('');

  // Modals state
  const [orgModalMode, setOrgModalMode] = useState<'create' | 'edit' | null>(null);
  const [editingOrg, setEditingOrg] = useState<Organization | null>(null);

  const [branchModalMode, setBranchModalMode] = useState<'create' | 'edit' | null>(null);
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null);
  const [presetBranchOrgId, setPresetBranchOrgId] = useState<string>('');

  const [terminalModalMode, setTerminalModalMode] = useState<'create' | 'edit' | null>(null);
  const [editingTerminal, setEditingTerminal] = useState<Terminal | null>(null);
  const [presetTerminalBranchId, setPresetTerminalBranchId] = useState<string>('');
  const [presetTerminalOrgId, setPresetTerminalOrgId] = useState<string>('');

  // Load all data
  const loadAllData = async (silent = false) => {
    if (!silent) setIsLoading(true);
    try {
      const orgsData = await getOrganizations();
      setOrganizations(orgsData);

      let currentOrgId = selectedOrgId;
      if (!currentOrgId && orgsData.length > 0) {
        currentOrgId = orgsData[0].id;
        setSelectedOrgId(currentOrgId);
      }

      // Load branches for all orgs or selected org
      const allBranches: Branch[] = [];
      const allTerminals: Terminal[] = [];

      for (const org of orgsData) {
        const brList = await getBranches(org.id);
        allBranches.push(...brList);
        for (const br of brList) {
          const termList = await getTerminals(br.id, org.id);
          allTerminals.push(...termList);
        }
      }

      setBranches(allBranches);
      setTerminals(allTerminals);

      if (currentOrgId && !selectedBranchId) {
        const firstBranch = allBranches.find((b) => b.orgId === currentOrgId);
        if (firstBranch) setSelectedBranchId(firstBranch.id);
      }
    } catch (error) {
      console.error('Failed to load system config data:', error);
      addToast({
        title: isThai ? 'เกิดข้อผิดพลาดในการโหลดข้อมูล' : 'Data Load Error',
        message: isThai ? 'ไม่สามารถดึงข้อมูลองค์กรจาก Firestore ได้' : 'Could not fetch organization data from Firestore.',
        type: 'error',
      });
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    setIsLoading(true);
    const unsubscribe = subscribeToOrganizationStructure(
      (hierarchy) => {
        const orgs = hierarchy.map((h) => {
          const { branches: _b, totalTerminals: _t, ...org } = h;
          return org;
        });
        const allBranches: Branch[] = [];
        const allTerminals: Terminal[] = [];
        for (const h of hierarchy) {
          for (const b of h.branches) {
            const { terminals: terms, ...branch } = b;
            allBranches.push(branch);
            allTerminals.push(...terms);
          }
        }
        setOrganizations(orgs);
        setBranches(allBranches);
        setTerminals(allTerminals);
        setIsLoading(false);
        setIsRefreshing(false);

        setSelectedOrgId((prev) => {
          if (prev && orgs.some((o) => o.id === prev)) return prev;
          return orgs.length > 0 ? orgs[0].id : '';
        });
      },
      {
        onError: (error) => {
          console.warn('Realtime structure subscription fallback:', error);
          void loadAllData();
        },
      },
    );

    return () => {
      unsubscribe();
    };
  }, []);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadAllData(true);
    addToast({
      title: isThai ? 'ซิงค์ข้อมูลสำเร็จ' : 'Synced with Firestore',
      message: isThai ? 'อัปเดตข้อมูลโครงสร้างองค์กรล่าสุดเรียบร้อยแล้ว' : 'Latest organization hierarchy synced.',
      type: 'info',
    });
  };

  // Filtered lists based on selection and search
  const currentOrg = organizations.find((o) => o.id === selectedOrgId);
  const currentBranch = branches.find((b) => b.id === selectedBranchId);

  const filteredOrgs = useMemo(() => {
    if (!searchQuery.trim()) return organizations;
    const q = searchQuery.toLowerCase();
    return organizations.filter(
      (o) =>
        o.name.toLowerCase().includes(q) ||
        o.slug.toLowerCase().includes(q) ||
        (o.taxId && o.taxId.includes(q)) ||
        o.id.toLowerCase().includes(q)
    );
  }, [organizations, searchQuery]);

  const filteredBranches = useMemo(() => {
    let list = branches;
    if (selectedOrgId) {
      list = list.filter((b) => b.orgId === selectedOrgId);
    }
    if (!searchQuery.trim()) return list;
    const q = searchQuery.toLowerCase();
    return list.filter(
      (b) =>
        b.name.toLowerCase().includes(q) ||
        (b.code && b.code.toLowerCase().includes(q)) ||
        b.address.toLowerCase().includes(q) ||
        (b.manager && b.manager.toLowerCase().includes(q))
    );
  }, [branches, selectedOrgId, searchQuery]);

  const filteredTerminals = useMemo(() => {
    let list = terminals;
    if (selectedBranchId) {
      list = list.filter((t) => t.branchId === selectedBranchId);
    } else if (selectedOrgId) {
      const orgBranchIds = new Set(branches.filter((b) => b.orgId === selectedOrgId).map((b) => b.id));
      list = list.filter((t) => (t.orgId ? t.orgId === selectedOrgId : orgBranchIds.has(t.branchId)));
    }
    if (!searchQuery.trim()) return list;
    const q = searchQuery.toLowerCase();
    return list.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.code.toLowerCase().includes(q) ||
        (t.deviceModel && t.deviceModel.toLowerCase().includes(q)) ||
        (t.ipAddress && t.ipAddress.includes(q))
    );
  }, [terminals, selectedBranchId, selectedOrgId, branches, searchQuery]);

  // Counts helpers
  const getBranchCount = (orgId: string) => branches.filter((b) => b.orgId === orgId).length;
  const getTerminalCountForOrg = (orgId: string) => {
    const orgBranchIds = new Set(branches.filter((b) => b.orgId === orgId).map((b) => b.id));
    return terminals.filter((t) => (t.orgId ? t.orgId === orgId : orgBranchIds.has(t.branchId))).length;
  };
  const getTerminalCountForBranch = (branchId: string) =>
    terminals.filter((t) => t.branchId === branchId).length;

  // Organization handlers
  const openCreateOrgModal = () => {
    setEditingOrg(null);
    setOrgModalMode('create');
  };

  const openEditOrgModal = (org: Organization) => {
    setEditingOrg(org);
    setOrgModalMode('edit');
  };

  const handleSaveOrg = async (input: CreateOrganizationInput) => {
    try {
      if (orgModalMode === 'create') {
        const created = await createOrganization(input);
        setOrganizations((prev) =>
          prev.some((o) => o.id === created.id) ? prev : [...prev, created]
        );
        setSelectedOrgId(created.id);
        addToast({
          title: isThai ? 'สร้างองค์กรสำเร็จ' : 'Organization Created',
          message: `${created.name} (${created.slug}) ${isThai ? 'บันทึกลงใน Firestore เรียบร้อย' : 'saved to Firestore.'}`,
          type: 'success',
        });
      } else if (orgModalMode === 'edit' && editingOrg) {
        const updated = await updateOrganization(editingOrg.id, input);
        setOrganizations((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
        addToast({
          title: isThai ? 'อัปเดตองค์กรสำเร็จ' : 'Organization Updated',
          message: `${updated.name} ${isThai ? 'อัปเดตข้อมูลโปรไฟล์เรียบร้อย' : 'profile updated in Firestore.'}`,
          type: 'success',
        });
      }
      setOrgModalMode(null);
      setEditingOrg(null);
    } catch (error) {
      console.error('Error saving organization:', error);
      addToast({
        title: isThai ? 'เกิดข้อผิดพลาด' : 'Operation Failed',
        message: isThai ? 'ไม่สามารถบันทึกข้อมูลองค์กรได้' : 'Could not save organization.',
        type: 'error',
      });
    }
  };

  // Branch handlers
  const openCreateBranchModal = (presetOrgId?: string) => {
    const parentOrgId = presetOrgId || selectedOrgId || organizations[0]?.id || '';
    setPresetBranchOrgId(parentOrgId);
    setEditingBranch(null);
    setBranchModalMode('create');
  };

  const openEditBranchModal = (branch: Branch) => {
    setPresetBranchOrgId(branch.orgId);
    setEditingBranch(branch);
    setBranchModalMode('edit');
  };

  const handleSaveBranch = async (input: CreateBranchInput) => {
    try {
      if (branchModalMode === 'create') {
        const created = await createBranch(input);
        setBranches((prev) =>
          prev.some((b) => b.id === created.id) ? prev : [...prev, created]
        );
        setSelectedBranchId(created.id);
        addToast({
          title: isThai ? 'สร้างสาขาสำเร็จ' : 'Branch Created',
          message: `${created.name} ${isThai ? 'บันทึกลงใน Firestore เรียบร้อย' : 'saved to Firestore.'}`,
          type: 'success',
        });
      } else if (branchModalMode === 'edit' && editingBranch) {
        const updated = await updateBranch(editingBranch.id, input);
        setBranches((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
        addToast({
          title: isThai ? 'อัปเดตสาขาสำเร็จ' : 'Branch Updated',
          message: `${updated.name} ${isThai ? 'อัปเดตข้อมูลสาขาเรียบร้อย' : 'branch updated.'}`,
          type: 'success',
        });
      }
      setBranchModalMode(null);
      setEditingBranch(null);
    } catch (error) {
      console.error('Error saving branch:', error);
      addToast({
        title: isThai ? 'เกิดข้อผิดพลาด' : 'Operation Failed',
        message: isThai ? 'ไม่สามารถบันทึกข้อมูลสาขาได้' : 'Could not save branch.',
        type: 'error',
      });
    }
  };

  // Terminal handlers
  const openCreateTerminalModal = (presetBranchId?: string, presetOrgId?: string) => {
    const parentBranchId = presetBranchId || selectedBranchId || branches[0]?.id || '';
    const parentBranch = branches.find((b) => b.id === parentBranchId);
    const parentOrgId = presetOrgId || parentBranch?.orgId || selectedOrgId || '';
    setPresetTerminalBranchId(parentBranchId);
    setPresetTerminalOrgId(parentOrgId);
    setEditingTerminal(null);
    setTerminalModalMode('create');
  };

  const openEditTerminalModal = (terminal: Terminal) => {
    setPresetTerminalBranchId(terminal.branchId);
    setPresetTerminalOrgId(terminal.orgId || '');
    setEditingTerminal(terminal);
    setTerminalModalMode('edit');
  };

  const handleSaveTerminal = async (input: CreateTerminalInput) => {
    try {
      const parentBranch = branches.find((b) => b.id === input.branchId);
      const effectiveOrgId = input.orgId || parentBranch?.orgId || selectedOrgId;

      if (terminalModalMode === 'create') {
        const created = await createTerminal({
          ...input,
          orgId: effectiveOrgId,
        });
        setTerminals((prev) =>
          prev.some((t) => t.id === created.id) ? prev : [...prev, created]
        );
        addToast({
          title: isThai ? 'ลงทะเบียนเครื่อง POS สำเร็จ' : 'Terminal Registered',
          message: `${created.name} (${created.code}) ${isThai ? 'ลงทะเบียนใน Firestore เรียบร้อย' : 'registered in Firestore.'}`,
          type: 'success',
        });
      } else if (terminalModalMode === 'edit' && editingTerminal) {
        const updated = await updateTerminal(editingTerminal.id, {
          ...input,
          orgId: effectiveOrgId,
        });
        setTerminals((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
        addToast({
          title: isThai ? 'อัปเดตเครื่อง POS สำเร็จ' : 'Terminal Updated',
          message: `${updated.name} ${isThai ? 'อัปเดตข้อมูลเรียบร้อย' : 'terminal updated.'}`,
          type: 'success',
        });
      }
      setTerminalModalMode(null);
      setEditingTerminal(null);
    } catch (error) {
      console.error('Error saving terminal:', error);
      addToast({
        title: isThai ? 'เกิดข้อผิดพลาด' : 'Operation Failed',
        message: isThai ? 'ไม่สามารถบันทึกข้อมูลเครื่อง POS ได้' : 'Could not save terminal.',
        type: 'error',
      });
    }
  };

  // Destructive Actions Execution & Global Confirmation Dialog Service
  const executeDeleteOrganization = async (org: Organization) => {
    try {
      const result = await deleteOrganizationCascade(org.id);
      setOrganizations((prev) => prev.filter((o) => o.id !== org.id));
      setBranches((prev) => prev.filter((b) => b.orgId !== org.id));
      setTerminals((prev) => prev.filter((t) => t.orgId !== org.id));
      if (selectedOrgId === org.id) {
        const remaining = organizations.filter((o) => o.id !== org.id);
        setSelectedOrgId(remaining[0]?.id || '');
      }
      addToast({
        title: isThai ? 'ลบองค์กรเรียบร้อย' : 'Organization Deleted',
        message: `${org.name} ${isThai ? `และสาขาย่อย (${result.branchesDeleted}) เครื่องขาย (${result.terminalsDeleted}) ถูกลบออกจาก Firestore แล้ว` : 'and child entities permanently deleted.'}`,
        type: 'info',
      });
    } catch (error) {
      console.error('Error deleting organization:', error);
      addToast({
        title: isThai ? 'ลบข้อมูลล้มเหลว' : 'Deletion Failed',
        message: isThai ? 'ไม่สามารถลบข้อมูลจาก Firestore ได้' : 'Could not delete organization from Firestore.',
        type: 'error',
      });
    }
  };

  const handleDeleteOrganization = async (org: Organization) => {
    const orgBranches = branches.filter((b) => b.orgId === org.id);
    const orgTerminals = terminals.filter((t) => t.orgId === org.id);
    const isConfirmed = await confirm(
      buildOrganizationDeleteConfirmation(org, orgBranches, orgTerminals, isThai)
    );
    if (!isConfirmed) return;
    await executeDeleteOrganization(org);
  };

  const executeDeleteBranch = async (branch: Branch) => {
    try {
      const result = await deleteBranchCascade(branch.id, branch.orgId || selectedOrgId);
      setBranches((prev) => prev.filter((b) => b.id !== branch.id));
      setTerminals((prev) => prev.filter((t) => t.branchId !== branch.id));
      if (selectedBranchId === branch.id) {
        const remaining = branches.filter(
          (b) => b.id !== branch.id && b.orgId === (branch.orgId || selectedOrgId)
        );
        setSelectedBranchId(remaining[0]?.id || '');
      }
      addToast({
        title: isThai ? 'ลบสาขาเรียบร้อย' : 'Branch Deleted',
        message: `${branch.name} ${isThai ? `และเครื่องขาย (${result.terminalsDeleted}) ถูกลบเรียบร้อยแล้ว` : 'and associated terminals removed.'}`,
        type: 'info',
      });
    } catch (error) {
      console.error('Error deleting branch:', error);
      addToast({
        title: isThai ? 'ลบข้อมูลล้มเหลว' : 'Deletion Failed',
        message: isThai ? 'ไม่สามารถลบข้อมูลสาขาจาก Firestore ได้' : 'Could not delete branch from Firestore.',
        type: 'error',
      });
    }
  };

  const handleDeleteBranch = async (branch: Branch) => {
    const branchTerminals = terminals.filter((t) => t.branchId === branch.id);
    const isConfirmed = await confirm(
      buildBranchDeleteConfirmation(branch, branchTerminals, isThai)
    );
    if (!isConfirmed) return;
    await executeDeleteBranch(branch);
  };

  const executeDeleteTerminal = async (term: Terminal) => {
    try {
      await deleteTerminal(term.id);
      setTerminals((prev) => prev.filter((t) => t.id !== term.id));
      addToast({
        title: isThai ? 'ยกเลิกลงทะเบียนเครื่อง POS เรียบร้อย' : 'Terminal De-registered',
        message: `${term.name} ${isThai ? 'ถูกลบออกจาก Firestore แล้ว' : 'removed from Firestore.'}`,
        type: 'info',
      });
    } catch (error) {
      console.error('Error deleting terminal:', error);
      addToast({
        title: isThai ? 'ลบข้อมูลล้มเหลว' : 'Deletion Failed',
        message: isThai ? 'ไม่สามารถลบข้อมูลเครื่อง POS จาก Firestore ได้' : 'Could not delete terminal from Firestore.',
        type: 'error',
      });
    }
  };

  const handleDeleteTerminal = async (term: Terminal) => {
    const isConfirmed = await confirm(buildTerminalDeleteConfirmation(term, isThai));
    if (!isConfirmed) return;
    await executeDeleteTerminal(term);
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    addToast({
      title: isThai ? 'คัดลอกสำเร็จ' : 'Copied to Clipboard',
      message: `${label}: ${text}`,
      type: 'info',
    });
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 font-sans">
      {/* Top Banner & Title Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white border border-slate-200 rounded-2xl p-5 shadow-xs">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-wider">
            <span className="text-[#ff6b1a]">PRODX ADMIN</span>
            <ChevronRight className="h-3 w-3" />
            <span>{isThai ? 'การจัดการองค์กร' : 'Organization Management'}</span>
          </div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight mt-1 flex items-center gap-2.5">
            <Building2 className="h-7 w-7 text-[#ff6b1a]" />
            {isThai ? 'ระบบบริหารโครงสร้างองค์กรและเครือข่ายสาขา' : 'Organization & Multi-Store Hierarchy'}
          </h1>
          <p className="text-xs text-slate-500 mt-1 max-w-2xl">
            {isThai
              ? 'จัดการโปรไฟล์องค์กร (Organization Profiles) ลำดับชั้นสาขา (Branches) และการลงทะเบียนเครื่องขาย POS (POS Terminals) พร้อมการจัดเก็บบน Firestore แบบ Record-Level Isolation'
              : 'Enterprise CRUD management for Organization profiles, hierarchical store branches, and POS terminal device registrations with Firestore record-level security.'}
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="flex items-center gap-1.5 text-xs font-bold"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            {isThai ? 'ซิงค์ Firestore' : 'Sync Firestore'}
          </Button>

          {/* View Mode Toggle */}
          <div className="flex items-center bg-slate-100 p-0.5 rounded-xl border border-slate-200">
            <button
              type="button"
              onClick={() => setViewMode('tabbed')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 ${
                viewMode === 'tabbed'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Sliders className="h-3.5 w-3.5" />
              {isThai ? 'แบบแท็บ' : 'Tabbed'}
            </button>
            <button
              type="button"
              onClick={() => setViewMode('hierarchy')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 ${
                viewMode === 'hierarchy'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Layers className="h-3.5 w-3.5" />
              {isThai ? 'แผนผังลำดับชั้น' : 'Hierarchy Flow'}
            </button>
          </div>
        </div>
      </div>

      {/* Live Firestore Write Queue & Offline Buffer Conflict Status Banner */}
      <AdminSyncStatusIndicator variant="banner" />

      {/* KPI Stats Overview Bar */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-4.5 shadow-2xs">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[11px] font-black uppercase tracking-wider text-slate-500">
              {isThai ? 'องค์กรทั้งหมด' : 'Total Organizations'}
            </span>
            <Building2 className="h-4 w-4 text-[#ff6b1a]" />
          </div>
          <div className="text-3xl font-black text-slate-900 mt-2">{organizations.length}</div>
          <div className="text-[11px] text-slate-500 mt-1 flex items-center gap-1">
            <span className="font-bold text-slate-700">{organizations.filter(o => o.status !== 'inactive').length}</span>
            <span>{isThai ? 'เปิดใช้งาน (Active)' : 'active profiles'}</span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4.5 shadow-2xs">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[11px] font-black uppercase tracking-wider text-slate-500">
              {isThai ? 'สาขาในระบบ' : 'Store Branches'}
            </span>
            <Store className="h-4 w-4 text-emerald-600" />
          </div>
          <div className="text-3xl font-black text-slate-900 mt-2">{branches.length}</div>
          <div className="text-[11px] text-slate-500 mt-1">
            <span>{isThai ? 'กระจายตัวในทุกองค์กร' : 'Across all organizations'}</span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4.5 shadow-2xs">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[11px] font-black uppercase tracking-wider text-slate-500">
              {isThai ? 'เครื่องขาย POS' : 'POS Terminals'}
            </span>
            <Monitor className="h-4 w-4 text-blue-600" />
          </div>
          <div className="text-3xl font-black text-slate-900 mt-2">{terminals.length}</div>
          <div className="text-[11px] text-emerald-600 font-bold mt-1 flex items-center gap-1">
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span>{terminals.filter(t => t.status !== 'inactive').length} {isThai ? 'พร้อมปฏิบัติการ' : 'operational'}</span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4.5 shadow-2xs">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[11px] font-black uppercase tracking-wider text-slate-500">
              {isThai ? 'ความปลอดภัยข้อมูล' : 'Data Isolation'}
            </span>
            <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          </div>
          <div className="text-sm font-black text-emerald-700 mt-2">Record-Level Scoped</div>
          <div className="text-[11px] text-slate-500 mt-1">
            {isThai ? 'ผูกสิทธิ์ orgId / branchId ชัดเจน' : 'Strict orgId & branchId schema'}
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      {viewMode === 'hierarchy' ? (
        /* ==================== HIERARCHY TREE VIEW ==================== */
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-black text-slate-900 flex items-center gap-2">
              <Layers className="h-5 w-5 text-[#ff6b1a]" />
              {isThai ? 'ผังโครงสร้างแบบลำดับชั้น (Hierarchical View)' : 'Organizational Hierarchy Flow'}
            </h2>
            <Button size="sm" onClick={openCreateOrgModal} className="flex items-center gap-1.5 font-bold">
              <Plus className="h-4 w-4" />
              {isThai ? 'เพิ่มองค์กรใหม่' : 'New Organization'}
            </Button>
          </div>

          <div className="space-y-6">
            {organizations.map((org) => {
              const orgBranches = branches.filter((b) => b.orgId === org.id);
              const isSelected = selectedOrgId === org.id;

              return (
                <div
                  key={org.id}
                  className={`bg-white border rounded-2xl p-5 shadow-xs transition-all ${
                    isSelected ? 'border-[#ff6b1a] ring-2 ring-[#ff6b1a]/10' : 'border-slate-200'
                  }`}
                >
                  {/* Organization Level Card Header */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
                    <div className="flex items-start sm:items-center gap-3">
                      <div className="h-12 w-12 rounded-xl bg-[#ff6b1a]/10 text-[#ff6b1a] flex items-center justify-center font-black">
                        <Building2 className="h-6 w-6" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-base font-black text-slate-900">{org.name}</h3>
                          <span className="font-mono text-[11px] bg-slate-100 px-2 py-0.5 rounded text-slate-700 font-bold">
                            slug: {org.slug}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${
                              org.status === 'inactive'
                                ? 'bg-rose-100 text-rose-700'
                                : 'bg-emerald-100 text-emerald-700'
                            }`}
                          >
                            {org.status || 'active'}
                          </span>
                        </div>
                        <div className="text-xs text-slate-400 flex items-center gap-3 mt-1 flex-wrap">
                          <span>ID: {org.id}</span>
                          {org.taxId && <span>Tax ID: {org.taxId}</span>}
                          {org.currency && <span>Currency: {org.currency}</span>}
                          <span>{orgBranches.length} {isThai ? 'สาขา' : 'branches'}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openCreateBranchModal(org.id)}
                        className="text-xs font-bold flex items-center gap-1"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        {isThai ? 'เพิ่มสาขา' : 'Add Branch'}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEditOrgModal(org)}
                        className="text-slate-600 hover:text-slate-900"
                      >
                        <Edit className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void handleDeleteOrganization(org)}
                        className="text-rose-500 hover:text-rose-700 hover:bg-rose-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  {/* Branches & Terminals Under this Org */}
                  <div className="mt-4 pl-0 sm:pl-6 space-y-4">
                    {orgBranches.length === 0 ? (
                      <div className="p-4 rounded-xl border border-dashed border-slate-200 text-center text-xs text-slate-400">
                        {isThai ? 'ยังไม่มีสาขาภายใต้องค์กรนี้' : 'No branches registered under this organization.'}
                      </div>
                    ) : (
                      orgBranches.map((branch) => {
                        const branchTerminals = terminals.filter((t) => t.branchId === branch.id);

                        return (
                          <div
                            key={branch.id}
                            className="bg-slate-50/70 border border-slate-200 rounded-xl p-4 space-y-3"
                          >
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                              <div className="flex items-center gap-2.5">
                                <div className="h-8 w-8 rounded-lg bg-emerald-500/10 text-emerald-700 flex items-center justify-center">
                                  <Store className="h-4 w-4" />
                                </div>
                                <div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs font-black text-slate-900">
                                      {branch.name}
                                    </span>
                                    {branch.code && (
                                      <span className="text-[10px] font-mono font-bold bg-white px-1.5 py-0.5 rounded border border-slate-200 text-slate-600">
                                        {branch.code}
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[11px] text-slate-500">{branch.address}</div>
                                </div>
                              </div>

                              <div className="flex items-center gap-1.5 self-end sm:self-auto">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => openCreateTerminalModal(branch.id, org.id)}
                                  className="h-7 text-[11px] px-2 font-bold"
                                >
                                  <Plus className="h-3 w-3 mr-1" />
                                  {isThai ? 'ลงทะเบียน POS' : 'Add Terminal'}
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => openEditBranchModal(branch)}
                                  className="h-7 w-7 p-0 text-slate-500 hover:text-slate-900"
                                >
                                  <Edit className="h-3 w-3" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => void handleDeleteBranch(branch)}
                                  className="h-7 w-7 p-0 text-rose-500 hover:text-rose-700 hover:bg-rose-50"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </div>
                            </div>

                            {/* Terminals Grid */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 pt-1">
                              {branchTerminals.map((term) => (
                                <div
                                  key={term.id}
                                  className="bg-white border border-slate-200/90 rounded-lg p-2.5 flex items-center justify-between text-xs shadow-2xs hover:border-slate-300 transition-colors"
                                >
                                  <div className="flex items-center gap-2">
                                    <Monitor className="h-4 w-4 text-blue-600 shrink-0" />
                                    <div>
                                      <div className="font-bold text-slate-900 leading-tight">
                                        {term.name}
                                      </div>
                                      <div className="text-[10px] text-slate-400 font-mono">
                                        {term.code} · {term.paperWidth || '80mm'}
                                      </div>
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-1">
                                    <button
                                      type="button"
                                      onClick={() => openEditTerminalModal(term)}
                                      className="p-1 text-slate-400 hover:text-slate-700"
                                      title={isThai ? 'แก้ไขเครื่อง' : 'Edit terminal'}
                                    >
                                      <Edit className="h-3 w-3" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => void handleDeleteTerminal(term)}
                                      className="p-1 text-slate-400 hover:text-rose-600"
                                      title={isThai ? 'ลบเครื่อง' : 'Delete terminal'}
                                    >
                                      <Trash2 className="h-3 w-3" />
                                    </button>
                                  </div>
                                </div>
                              ))}
                              {branchTerminals.length === 0 && (
                                <div className="col-span-full py-2 text-center text-[11px] text-slate-400 italic">
                                  {isThai ? 'ยังไม่มีเครื่อง POS ในสาขานี้' : 'No POS terminals registered yet.'}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* ==================== TABBED CRUD MANAGEMENT VIEW ==================== */
        <div className="space-y-6">
          {/* Section Navigation Tabs & Search */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setActiveTab('organizations')}
                className={`px-4 py-2 text-xs font-black rounded-xl transition-all flex items-center gap-2 ${
                  activeTab === 'organizations'
                    ? 'bg-[#ff6b1a] text-white shadow-xs'
                    : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Building2 className="h-3.5 w-3.5" />
                {isThai ? '1. องค์กร (Organizations)' : '1. Organizations'}
                <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-black/10">
                  {organizations.length}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('branches')}
                className={`px-4 py-2 text-xs font-black rounded-xl transition-all flex items-center gap-2 ${
                  activeTab === 'branches'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Store className="h-3.5 w-3.5" />
                {isThai ? '2. สาขา (Store Branches)' : '2. Store Branches'}
                <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-black/10">
                  {branches.length}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('terminals')}
                className={`px-4 py-2 text-xs font-black rounded-xl transition-all flex items-center gap-2 ${
                  activeTab === 'terminals'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Monitor className="h-3.5 w-3.5" />
                {isThai ? '3. เครื่องขาย (POS Terminals)' : '3. POS Terminals'}
                <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-black/10">
                  {terminals.length}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('audit')}
                className={`px-4 py-2 text-xs font-black rounded-xl transition-all flex items-center gap-2 ${
                  activeTab === 'audit'
                    ? 'bg-purple-600 text-white shadow-xs'
                    : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Shield className="h-3.5 w-3.5" />
                {isThai ? '4. ประวัติ CRUD (Audit Log)' : '4. Audit Logs'}
                <span className="flex h-2 w-2 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
              </button>
            </div>

            {/* Universal Search Input */}
            <div className="relative w-full sm:w-72">
              <Search className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder={isThai ? 'ค้นหาชื่อ รหัส หรือ ID...' : 'Search by name, code, or ID...'}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl focus:outline-hidden focus:border-[#ff6b1a] text-slate-900"
              />
            </div>
          </div>

          {/* ================= TAB 1: ORGANIZATIONS ================= */}
          {activeTab === 'organizations' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-black text-slate-900">
                    {isThai ? 'รายการโปรไฟล์องค์กร' : 'Organization Profiles'}
                  </h2>
                  <p className="text-xs text-slate-500">
                    {isThai
                      ? 'องค์กรเป็นระดับสูงสุดของโครงสร้างร้านค้า สำหรับแบ่งแยกฐานข้อมูลและข้อมูลทางการเงิน'
                      : 'Highest-level multi-tenant entity for isolating accounting, staff, and transaction data.'}
                  </p>
                </div>
                <Button
                  size="sm"
                  onClick={openCreateOrgModal}
                  className="flex items-center gap-1.5 font-bold"
                >
                  <Plus className="h-4 w-4" />
                  {isThai ? 'สร้างองค์กรใหม่' : 'New Organization'}
                </Button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredOrgs.map((org) => {
                  const bCount = getBranchCount(org.id);
                  const tCount = getTerminalCountForOrg(org.id);
                  const isSelected = selectedOrgId === org.id;

                  return (
                    <div
                      key={org.id}
                      onClick={() => setSelectedOrgId(org.id)}
                      className={`bg-white border rounded-2xl p-5 cursor-pointer transition-all space-y-4 shadow-2xs hover:shadow-xs ${
                        isSelected
                          ? 'border-[#ff6b1a] ring-2 ring-[#ff6b1a]/15'
                          : 'border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-xl bg-[#ff6b1a]/10 text-[#ff6b1a] flex items-center justify-center font-black">
                            <Building2 className="h-5 w-5" />
                          </div>
                          <div>
                            <h3 className="text-sm font-black text-slate-900 leading-snug">
                              {org.name}
                            </h3>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="font-mono text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-bold">
                                {org.slug}
                              </span>
                              <span
                                className={`text-[10px] font-bold px-1.5 py-0.2 rounded-full uppercase ${
                                  org.status === 'inactive'
                                    ? 'bg-rose-100 text-rose-700'
                                    : 'bg-emerald-100 text-emerald-700'
                                }`}
                              >
                                {org.status || 'active'}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openEditOrgModal(org)}
                            className="h-8 w-8 p-0 text-slate-500 hover:text-slate-900"
                            title={isThai ? 'แก้ไขโปรไฟล์' : 'Edit profile'}
                          >
                            <Edit className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void handleDeleteOrganization(org)}
                            className="h-8 w-8 p-0 text-rose-500 hover:text-rose-700 hover:bg-rose-50"
                            title={isThai ? 'ลบองค์กร' : 'Delete organization'}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>

                      <div className="bg-slate-50 rounded-xl p-3 text-xs space-y-1.5 text-slate-600 border border-slate-100">
                        <div className="flex items-center justify-between">
                          <span className="text-slate-400">ID:</span>
                          <span className="font-mono text-[11px] text-slate-800 flex items-center gap-1">
                            {org.id.slice(0, 16)}...
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                copyToClipboard(org.id, 'Org ID');
                              }}
                              className="text-slate-400 hover:text-slate-700"
                            >
                              <Copy className="h-2.5 w-2.5" />
                            </button>
                          </span>
                        </div>
                        {org.taxId && (
                          <div className="flex items-center justify-between">
                            <span className="text-slate-400">{isThai ? 'เลขภาษี:' : 'Tax ID:'}</span>
                            <span className="font-mono text-slate-800">{org.taxId}</span>
                          </div>
                        )}
                        {org.phone && (
                          <div className="flex items-center justify-between">
                            <span className="text-slate-400">{isThai ? 'โทร:' : 'Phone:'}</span>
                            <span className="text-slate-800">{org.phone}</span>
                          </div>
                        )}
                        {org.currency && (
                          <div className="flex items-center justify-between">
                            <span className="text-slate-400">{isThai ? 'สกุลเงิน:' : 'Currency:'}</span>
                            <span className="font-bold text-slate-800">{org.currency}</span>
                          </div>
                        )}
                      </div>

                      <div className="flex items-center justify-between pt-1 border-t border-slate-100 text-xs">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 font-bold text-[11px]">
                            {bCount} {isThai ? 'สาขา' : 'branches'}
                          </span>
                          <span className="px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 font-bold text-[11px]">
                            {tCount} {isThai ? 'เครื่อง' : 'terminals'}
                          </span>
                        </div>

                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedOrgId(org.id);
                            setActiveTab('branches');
                          }}
                          className="text-[11px] font-bold text-[#ff6b1a] hover:bg-[#ff6b1a]/10 flex items-center gap-1"
                        >
                          {isThai ? 'ดูสาขา' : 'View Branches'}
                          <ChevronRight className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ================= TAB 2: STORE BRANCHES ================= */}
          {activeTab === 'branches' && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-black text-slate-900">
                    {isThai ? 'รายการสาขาและที่ตั้งร้าน' : 'Store Branches & Locations'}
                  </h2>
                  <p className="text-xs text-slate-500">
                    {isThai
                      ? 'สาขาแต่ละแห่งจะสังกัดอยู่ภายใต้องค์กร และเป็นศูนย์กลางของสต็อกสินค้าและจุดขาย'
                      : 'Physical or virtual store branches that hold inventory and house POS checkout terminals.'}
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-500 whitespace-nowrap">
                      {isThai ? 'กรองตามองค์กร:' : 'Filter Org:'}
                    </span>
                    <select
                      value={selectedOrgId}
                      onChange={(e) => setSelectedOrgId(e.target.value)}
                      className="px-3 py-1.5 text-xs font-bold bg-white border border-slate-200 rounded-xl text-slate-900 focus:outline-hidden"
                    >
                      <option value="">{isThai ? '-- ทั้งหมดทุกองค์กร --' : '-- All Organizations --'}</option>
                      {organizations.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name} ({o.slug})
                        </option>
                      ))}
                    </select>
                  </div>

                  <Button
                    size="sm"
                    onClick={() => openCreateBranchModal(selectedOrgId)}
                    className="flex items-center gap-1.5 font-bold"
                  >
                    <Plus className="h-4 w-4" />
                    {isThai ? 'เพิ่มสาขาใหม่' : 'New Branch'}
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredBranches.map((branch) => {
                  const parentOrg = organizations.find((o) => o.id === branch.orgId);
                  const tCount = getTerminalCountForBranch(branch.id);
                  const isSelected = selectedBranchId === branch.id;

                  return (
                    <div
                      key={branch.id}
                      onClick={() => setSelectedBranchId(branch.id)}
                      className={`bg-white border rounded-2xl p-5 cursor-pointer transition-all space-y-4 shadow-2xs hover:shadow-xs ${
                        isSelected
                          ? 'border-emerald-600 ring-2 ring-emerald-600/15'
                          : 'border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-xl bg-emerald-500/10 text-emerald-700 flex items-center justify-center font-black">
                            <Store className="h-5 w-5" />
                          </div>
                          <div>
                            <h3 className="text-sm font-black text-slate-900 leading-snug">
                              {branch.name}
                            </h3>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              {branch.code && (
                                <span className="font-mono text-[10px] bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded font-bold">
                                  {branch.code}
                                </span>
                              )}
                              <span className="text-[10px] font-bold text-slate-500">
                                {parentOrg?.name || branch.orgId}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openEditBranchModal(branch)}
                            className="h-8 w-8 p-0 text-slate-500 hover:text-slate-900"
                            title={isThai ? 'แก้ไขสาขา' : 'Edit branch'}
                          >
                            <Edit className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void handleDeleteBranch(branch)}
                            className="h-8 w-8 p-0 text-rose-500 hover:text-rose-700 hover:bg-rose-50"
                            title={isThai ? 'ลบสาขา' : 'Delete branch'}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>

                      <div className="bg-slate-50 rounded-xl p-3 text-xs space-y-1.5 text-slate-600 border border-slate-100">
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-slate-400 whitespace-nowrap">{isThai ? 'ที่อยู่:' : 'Address:'}</span>
                          <span className="text-slate-800 text-right leading-relaxed">{branch.address}</span>
                        </div>
                        {branch.phone && (
                          <div className="flex items-center justify-between">
                            <span className="text-slate-400">{isThai ? 'เบอร์โทร:' : 'Phone:'}</span>
                            <span className="text-slate-800">{branch.phone}</span>
                          </div>
                        )}
                        {branch.manager && (
                          <div className="flex items-center justify-between">
                            <span className="text-slate-400">{isThai ? 'ผู้จัดการ:' : 'Manager:'}</span>
                            <span className="font-bold text-slate-800">{branch.manager}</span>
                          </div>
                        )}
                      </div>

                      <div className="flex items-center justify-between pt-1 border-t border-slate-100 text-xs">
                        <span className="px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 font-bold text-[11px]">
                          {tCount} {isThai ? 'เครื่องขายประจำสาขา' : 'POS terminals'}
                        </span>

                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedBranchId(branch.id);
                            if (branch.orgId) setSelectedOrgId(branch.orgId);
                            setActiveTab('terminals');
                          }}
                          className="text-[11px] font-bold text-emerald-700 hover:bg-emerald-50 flex items-center gap-1"
                        >
                          {isThai ? 'จัดการเครื่องขาย' : 'Manage Terminals'}
                          <ChevronRight className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  );
                })}

                {filteredBranches.length === 0 && (
                  <div className="col-span-full py-12 text-center bg-white border border-dashed border-slate-200 rounded-2xl">
                    <Store className="h-10 w-10 text-slate-300 mx-auto mb-2" />
                    <p className="text-sm font-bold text-slate-600">
                      {isThai ? 'ไม่พบสาขาตามเงื่อนไขที่เลือก' : 'No store branches found.'}
                    </p>
                    <p className="text-xs text-slate-400 mt-1">
                      {isThai ? 'กดปุ่มด้านบนเพื่อเพิ่มสาขาใหม่เข้าสู่ระบบ' : 'Click "New Branch" to create one.'}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ================= TAB 3: POS TERMINALS ================= */}
          {activeTab === 'terminals' && (
            <div className="space-y-4">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-black text-slate-900">
                    {isThai ? 'รายการลงทะเบียนเครื่องขาย POS (Terminal Registrations)' : 'POS Terminal Registrations'}
                  </h2>
                  <p className="text-xs text-slate-500">
                    {isThai
                      ? 'บันทึกข้อมูลเครื่องขาย แคชเชียร์ หมายเลขประจำเครื่อง และการตั้งค่าฮาร์ดแวร์ใบเสร็จ'
                      : 'Register and manage checkout stations, terminal codes, hardware models, and receipt printer specs.'}
                  </p>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {/* Org Filter */}
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-bold text-slate-500 whitespace-nowrap">
                      {isThai ? 'องค์กร:' : 'Org:'}
                    </span>
                    <select
                      value={selectedOrgId}
                      onChange={(e) => {
                        setSelectedOrgId(e.target.value);
                        setSelectedBranchId('');
                      }}
                      className="px-2.5 py-1.5 text-xs font-bold bg-white border border-slate-200 rounded-xl text-slate-900 focus:outline-hidden"
                    >
                      <option value="">{isThai ? '-- ทุกองค์กร --' : '-- All Orgs --'}</option>
                      {organizations.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Branch Filter */}
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-bold text-slate-500 whitespace-nowrap">
                      {isThai ? 'สาขา:' : 'Branch:'}
                    </span>
                    <select
                      value={selectedBranchId}
                      onChange={(e) => setSelectedBranchId(e.target.value)}
                      className="px-2.5 py-1.5 text-xs font-bold bg-white border border-slate-200 rounded-xl text-slate-900 focus:outline-hidden"
                    >
                      <option value="">{isThai ? '-- ทุกสาขา --' : '-- All Branches --'}</option>
                      {branches
                        .filter((b) => !selectedOrgId || b.orgId === selectedOrgId)
                        .map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name} ({b.code || b.id})
                          </option>
                        ))}
                    </select>
                  </div>

                  <Button
                    size="sm"
                    onClick={() => openCreateTerminalModal(selectedBranchId, selectedOrgId)}
                    className="flex items-center gap-1.5 font-bold"
                  >
                    <Plus className="h-4 w-4" />
                    {isThai ? 'ลงทะเบียนเครื่องใหม่' : 'Register Terminal'}
                  </Button>
                </div>
              </div>

              {/* Terminals Table / Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredTerminals.map((term) => {
                  const parentBranch = branches.find((b) => b.id === term.branchId);
                  const parentOrg = organizations.find(
                    (o) => o.id === (term.orgId || parentBranch?.orgId)
                  );

                  return (
                    <div
                      key={term.id}
                      className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4 shadow-2xs hover:border-slate-300 transition-all"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-xl bg-blue-500/10 text-blue-700 flex items-center justify-center font-black">
                            <Monitor className="h-5 w-5" />
                          </div>
                          <div>
                            <h3 className="text-sm font-black text-slate-900 leading-snug">
                              {term.name}
                            </h3>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="font-mono text-[10px] font-bold bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded border border-blue-200/50">
                                {term.code}
                              </span>
                              <span
                                className={`text-[10px] font-bold px-1.5 py-0.2 rounded-full uppercase ${
                                  term.status === 'maintenance'
                                    ? 'bg-amber-100 text-amber-700'
                                    : term.status === 'inactive'
                                    ? 'bg-rose-100 text-rose-700'
                                    : 'bg-emerald-100 text-emerald-700'
                                }`}
                              >
                                {term.status || 'active'}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openEditTerminalModal(term)}
                            className="h-8 w-8 p-0 text-slate-500 hover:text-slate-900"
                            title={isThai ? 'แก้ไขข้อมูลเครื่อง' : 'Edit terminal'}
                          >
                            <Edit className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void handleDeleteTerminal(term)}
                            className="h-8 w-8 p-0 text-rose-500 hover:text-rose-700 hover:bg-rose-50"
                            title={isThai ? 'ลบเครื่อง POS' : 'Delete terminal'}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>

                      <div className="bg-slate-50 rounded-xl p-3 text-xs space-y-1.5 text-slate-600 border border-slate-100">
                        <div className="flex items-center justify-between">
                          <span className="text-slate-400">{isThai ? 'สังกัดสาขา:' : 'Branch:'}</span>
                          <span className="font-bold text-slate-800">
                            {parentBranch?.name || term.branchId}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-slate-400">{isThai ? 'องค์กร:' : 'Org:'}</span>
                          <span className="text-slate-700">{parentOrg?.name || term.orgId || 'N/A'}</span>
                        </div>
                        {term.deviceModel && (
                          <div className="flex items-center justify-between">
                            <span className="text-slate-400">{isThai ? 'รุ่นอุปกรณ์:' : 'Hardware:'}</span>
                            <span className="text-slate-800">{term.deviceModel}</span>
                          </div>
                        )}
                        {term.ipAddress && (
                          <div className="flex items-center justify-between">
                            <span className="text-slate-400">{isThai ? 'IP Address:' : 'IP Address:'}</span>
                            <span className="font-mono text-slate-800">{term.ipAddress}</span>
                          </div>
                        )}
                        <div className="flex items-center justify-between">
                          <span className="text-slate-400">{isThai ? 'หน้ากว้างกระดาษ:' : 'Printer Paper:'}</span>
                          <span className="font-bold text-slate-800">{term.paperWidth || '80mm'}</span>
                        </div>
                      </div>

                      <div className="pt-1 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400 font-mono">
                        <span>ID: {term.id.slice(0, 14)}...</span>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(term.id, 'Terminal Registration Token')}
                          className="text-[#ff6b1a] hover:underline flex items-center gap-1 font-sans font-bold"
                        >
                          <Copy className="h-3 w-3" />
                          {isThai ? 'คัดลอก Token' : 'Copy ID'}
                        </button>
                      </div>
                    </div>
                  );
                })}

                {filteredTerminals.length === 0 && (
                  <div className="col-span-full py-12 text-center bg-white border border-dashed border-slate-200 rounded-2xl">
                    <Monitor className="h-10 w-10 text-slate-300 mx-auto mb-2" />
                    <p className="text-sm font-bold text-slate-600">
                      {isThai ? 'ไม่พบเครื่องขาย POS ที่ตรงกับเงื่อนไข' : 'No POS terminals found.'}
                    </p>
                    <p className="text-xs text-slate-400 mt-1">
                      {isThai
                        ? 'กดปุ่ม "ลงทะเบียนเครื่องใหม่" เพื่อเพิ่มเครื่องจุดขายสำหรับสาขา'
                        : 'Click "Register Terminal" to register a new checkout station.'}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ================= TAB 4: AUDIT LOGS ================= */}
          {activeTab === 'audit' && (
            <OrganizationAuditLogTab initialOrgId={selectedOrgId} />
          )}
        </div>
      )}

      {/* ================= MODULAR CRUD DIALOGS ================= */}
      <OrganizationFormDialog
        isOpen={Boolean(orgModalMode)}
        mode={orgModalMode || 'create'}
        initialData={editingOrg}
        existingOrganizations={organizations}
        branches={branches}
        terminals={terminals}
        onClose={() => {
          setOrgModalMode(null);
          setEditingOrg(null);
        }}
        onSubmit={handleSaveOrg}
        onConfirmDelete={executeDeleteOrganization}
      />

      <BranchFormDialog
        isOpen={Boolean(branchModalMode)}
        mode={branchModalMode || 'create'}
        initialData={editingBranch}
        presetOrgId={presetBranchOrgId || selectedOrgId}
        organizations={organizations}
        existingBranches={branches}
        terminals={terminals}
        onClose={() => {
          setBranchModalMode(null);
          setEditingBranch(null);
        }}
        onSubmit={handleSaveBranch}
        onConfirmDelete={executeDeleteBranch}
      />

      <TerminalFormDialog
        isOpen={Boolean(terminalModalMode)}
        mode={terminalModalMode || 'create'}
        initialData={editingTerminal}
        presetOrgId={presetTerminalOrgId || selectedOrgId}
        presetBranchId={presetTerminalBranchId || selectedBranchId}
        organizations={organizations}
        branches={branches}
        existingTerminals={terminals}
        onClose={() => {
          setTerminalModalMode(null);
          setEditingTerminal(null);
        }}
        onSubmit={handleSaveTerminal}
        onConfirmDelete={executeDeleteTerminal}
      />
    </div>
  );
};
