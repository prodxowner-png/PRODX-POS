import React, { useState, useEffect } from 'react';
import { Customer } from '../../domain/order';
import { useLanguage } from '../../context/LanguageContext';
import { Card } from '../../components/common/Card';
import { Badge } from '../../components/common/Badge';
import { Button } from '../../components/common/Button';
import { SearchInput } from '../../components/common/SearchInput';
import { Modal } from '../../components/common/Modal';
import { Users, Star, Phone, Mail, Plus } from 'lucide-react';
import { customersService } from '../../services/customersService';

export const CustomersScreen: React.FC = () => {
  const { t, language } = useLanguage();
  const [customers, setCustomers] = useState<Customer[]>(() => customersService.getCustomers());
  const [search, setSearch] = useState(() => {
    const saved =
      sessionStorage.getItem('prodx_customer_search') ||
      localStorage.getItem('prodx_customer_search');
    if (saved) {
      sessionStorage.removeItem('prodx_customer_search');
      localStorage.removeItem('prodx_customer_search');
      return saved;
    }
    return '';
  });
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');

  useEffect(() => {
    const unsubscribe = customersService.subscribe(() => {
      setCustomers(customersService.getCustomers());
    });

    const handleSearchCustomerEvent = (e: Event) => {
      const customEvt = e as CustomEvent<{ search: string }>;
      if (customEvt.detail?.search) {
        setSearch(customEvt.detail.search);
      }
    };

    window.addEventListener('prodx:search-customer', handleSearchCustomerEvent);

    return () => {
      unsubscribe();
      window.removeEventListener('prodx:search-customer', handleSearchCustomerEvent);
    };
  }, []);

  const filtered = customers.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.phone.includes(search) ||
      c.email.toLowerCase().includes(search.toLowerCase())
  );

  const handleAddCustomer = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const newCust: Customer = {
      id: `cust-${Date.now()}`,
      name: name.trim(),
      phone: phone.trim() || '+66 81 000 0000',
      email: email.trim() || 'customer@example.com',
      loyaltyTier: 'Bronze',
      loyaltyPoints: 10,
    };

    customersService.addCustomer(newCust);
    setName('');
    setPhone('');
    setEmail('');
    setIsAddModalOpen(false);
  };

  const vipCount = customers.filter((c) => c.loyaltyTier === 'VIP').length;
  const totalPoints = customers.reduce((acc, c) => acc + (c.loyaltyPoints || 0), 0);

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto p-4 sm:p-6 lg:p-8 space-y-6 bg-background text-text no-scrollbar">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 sm:gap-6 pb-4 sm:pb-6 border-b border-border/50">
        <div>
          <h1 className="text-heading-1 text-text">
            {t.customers.title}
          </h1>
          <p className="text-caption text-text/70 mt-1">
            {t.customers.subtitle}
          </p>
        </div>

        <Button
          variant="primary"
          size="md"
          onClick={() => setIsAddModalOpen(true)}
          leftIcon={<Plus className="h-4 w-4" />}
        >
          {t.customers.addCustomer}
        </Button>
      </div>

      {/* CRM Overview KPI Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="p-4 rounded-xl border border-border border-crisp bg-card shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between text-label-xs text-text/60">
            <span>{language === 'th' ? 'สมาชิกรวมทั้งหมด' : 'Total Profiles'}</span>
            <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
              <Users className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 text-2xl font-black font-mono tabular-nums tracking-tight text-text">
            {customers.length} <span className="text-caption font-sans font-medium text-text/60">{language === 'th' ? 'คน' : 'members'}</span>
          </div>
          <div className="mt-1.5 text-caption-sm text-text/60">
            {language === 'th' ? 'ฐานข้อมูลลูกค้าประจำสาขา' : 'Registered customer base'}
          </div>
        </div>

        <div className="p-4 rounded-xl border border-border border-crisp bg-card shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs font-semibold text-text/60 uppercase tracking-wider">
            <span>{language === 'th' ? 'สมาชิกระดับ VIP' : 'VIP Members'}</span>
            <div className="p-1.5 rounded-lg bg-primary/10 text-brand-text-accent">
              <Star className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 text-2xl font-black font-mono tabular-nums tracking-tight text-brand-text-accent">
            {vipCount} <span className="text-xs font-sans font-medium text-text/60">{language === 'th' ? 'คน' : 'VIP'}</span>
          </div>
          <div className="mt-1.5 text-[11px] text-text/60">
            {language === 'th' ? 'สิทธิประโยชน์ส่วนลดพิเศษ' : 'Exclusive reward tier'}
          </div>
        </div>

        <div className="p-4 rounded-xl border border-border border-crisp bg-card shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs font-semibold text-text/60 uppercase tracking-wider">
            <span>{language === 'th' ? 'แต้มสะสมทั้งหมด' : 'Loyalty Points'}</span>
            <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-500">
              <Star className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 text-2xl font-black font-mono tabular-nums tracking-tight text-amber-500">
            {totalPoints.toLocaleString()} <span className="text-xs font-sans font-medium text-text/60">{language === 'th' ? 'แต้ม' : 'pts'}</span>
          </div>
          <div className="mt-1.5 text-[11px] text-text/60">
            {language === 'th' ? 'ยอดคะแนนพร้อมแลกรับส่วนลด' : 'Available redeemable points'}
          </div>
        </div>

        <div className="p-4 rounded-xl border border-border border-crisp bg-card shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs font-semibold text-text/60 uppercase tracking-wider">
            <span>{language === 'th' ? 'ผลการค้นหา' : 'Filter Matches'}</span>
            <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <Users className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 text-2xl font-black font-mono tabular-nums tracking-tight text-text">
            {filtered.length} <span className="text-xs font-sans font-medium text-text/60">{language === 'th' ? 'รายการ' : 'matching'}</span>
          </div>
          <div className="mt-1.5 text-[11px] text-text/60">
            {search ? (language === 'th' ? `ตรงกับ "${search}"` : `Matches "${search}"`) : (language === 'th' ? 'แสดงข้อมูลทั้งหมด' : 'All records shown')}
          </div>
        </div>
      </div>

      {/* Search Input Bar */}
      <div className="max-w-md">
        <SearchInput
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onClear={() => setSearch('')}
          placeholder={t.customers.searchPlaceholder}
        />
      </div>

      {/* Balanced Full-Width Customers Table */}
      <Card className="shadow-2xs flex-1 flex flex-col overflow-hidden min-h-0 border-border">
        <div className="w-full overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-left text-xs border-collapse min-w-[600px]">
            <thead>
              <tr className="border-b border-border text-text/70 bg-card font-semibold">
                <th className="py-3.5 px-5">{t.customers.name}</th>
                <th className="py-3.5 px-4">{t.customers.phone}</th>
                <th className="py-3.5 px-4">{t.customers.email}</th>
                <th className="py-3.5 px-4">{t.customers.tier}</th>
                <th className="py-3.5 px-5 text-right">{t.customers.points}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-brand-text-secondary">
                    <Users className="h-8 w-8 mx-auto text-brand-text-secondary mb-2" />
                    <p className="text-xs font-semibold text-text">
                      {language === 'th' ? 'ไม่พบข้อมูลลูกค้า' : 'No customers found'}
                    </p>
                    <p className="text-[11px] text-brand-text-secondary mt-0.5">
                      {language === 'th' ? 'ลองค้นหาด้วยชื่อ เบอร์โทร หรืออีเมลอื่น' : 'Try searching by a different name, phone, or email.'}
                    </p>
                  </td>
                </tr>
              ) : (
                filtered.map((c) => (
                  <tr key={c.id} className="hover:bg-background/80 transition-colors">
                    <td className="py-3.5 px-5 font-bold text-text">
                      {c.name}
                    </td>
                    <td className="py-3.5 px-4 text-text/70 font-mono tabular-nums flex items-center gap-1.5">
                      <Phone className="h-3 w-3 text-brand-text-secondary" />
                      <span>{c.phone}</span>
                    </td>
                    <td className="py-3.5 px-4 text-text/70">
                      <span className="flex items-center gap-1.5">
                        <Mail className="h-3 w-3 text-brand-text-secondary" />
                        <span>{c.email}</span>
                      </span>
                    </td>
                    <td className="py-3.5 px-4">
                      <Badge variant={c.loyaltyTier === 'VIP' ? 'purple' : 'neutral'} size="sm">
                        {c.loyaltyTier}
                      </Badge>
                    </td>
                    <td className="py-3.5 px-5 text-right font-mono tabular-nums font-bold text-primary">
                      {c.loyaltyPoints} {language === 'th' ? 'แต้ม' : 'pts'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Add Customer Modal */}
      <Modal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        title={t.customers.addCustomer}
        description={language === 'th' ? 'สร้างข้อมูลลูกค้าเพื่อสะสมแต้มและรับใบเสร็จทางอีเมล' : 'Attach profile for loyalty perks and email receipts.'}
        maxWidth="sm"
      >
        <form onSubmit={handleAddCustomer} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-text/80 mb-1">
              {t.customers.name} *
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Alex Morgan"
              className="w-full rounded-lg border border-border bg-background text-xs py-2.5 px-3 text-text focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-text/80 mb-1">
              {t.customers.phone}
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+66 81 000 0000"
              className="w-full rounded-lg border border-border bg-background text-xs py-2.5 px-3 text-text focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-text/80 mb-1">
              {t.customers.email}
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="alex@example.com"
              className="w-full rounded-lg border border-border bg-background text-xs py-2.5 px-3 text-text focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
            />
          </div>

          <div className="pt-2 flex items-center justify-end gap-2">
            <Button variant="secondary" size="md" onClick={() => setIsAddModalOpen(false)}>
              {t.common.cancel}
            </Button>
            <Button variant="primary" size="md" type="submit">
              {t.customers.saveCustomer}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
