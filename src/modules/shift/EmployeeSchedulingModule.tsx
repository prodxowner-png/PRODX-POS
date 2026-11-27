import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { useToast } from '../../context/ToastContext';
import { Button } from '../../components/common/Button';
import { Badge } from '../../components/common/Badge';
import { Modal } from '../../components/common/Modal';
import { formatMoney, createMoney } from '../../domain/money';
import { playScannerSound } from '../../services/soundService';
import { triggerHaptic } from '../../services/hapticService';
import {
  Calendar,
  Clock,
  Users,
  Plus,
  CheckCircle2,
  AlertCircle,
  TrendingUp,
  Briefcase,
  ArrowRightLeft,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  UserCheck
} from 'lucide-react';

export interface ShiftRosterEntry {
  id: string;
  staffId: string;
  staffName: string;
  role: string;
  dateStr: string; // YYYY-MM-DD
  shiftType: 'morning' | 'evening' | 'full' | 'off';
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  estLaborCostCents: number;
}

const STORAGE_KEY = 'prodx_employee_scheduling_roster';

export const EmployeeSchedulingModule: React.FC = () => {
  const { session } = useAuth();
  const { language } = useLanguage();
  const { addToast } = useToast();

  const [currentWeekOffset, setCurrentWeekOffset] = useState(0);
  const [roster, setRoster] = useState<ShiftRosterEntry[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {}
    }
    return [];
  });

  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
  const [selectedStaffId, setSelectedStaffId] = useState('');
  const [selectedDateStr, setSelectedDateStr] = useState('');
  const [selectedShiftType, setSelectedShiftType] = useState<'morning' | 'evening' | 'full' | 'off'>('morning');

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(roster));
  }, [roster]);

  if (!session) return null;

  const staffList = session.organization.stores.flatMap(() => [
    { id: 'usr-01', name: 'Somchai Jaidee', role: 'Cashier', hourlyRateCents: 12000 },
    { id: 'usr-02', name: 'Napon Prasert', role: 'Store Manager', hourlyRateCents: 20000 },
    { id: 'usr-03', name: 'Kanda Wong', role: 'Senior Cashier', hourlyRateCents: 15000 },
    { id: 'usr-04', name: 'Anan Srisawat', role: 'Inventory Tech', hourlyRateCents: 14000 },
  ]).filter((v, i, a) => a.findIndex((t) => t.id === v.id) === i);

  // Compute current week's 7 days (Mon - Sun)
  const getWeekDays = (offset: number) => {
    const today = new Date();
    const dayOfWeek = today.getDay(); // 0 is Sun
    const distanceToMon = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(today);
    monday.setDate(today.getDate() + distanceToMon + offset * 7);

    const days: { date: Date; dateStr: string; dayLabelTh: string; dayLabelEn: string }[] = [];
    const dayLabelsTh = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์', 'อาทิตย์'];
    const dayLabelsEn = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      days.push({
        date: d,
        dateStr: d.toISOString().split('T')[0],
        dayLabelTh: dayLabelsTh[i],
        dayLabelEn: dayLabelsEn[i],
      });
    }
    return days;
  };

  const weekDays = getWeekDays(currentWeekOffset);

  const handleAssignShift = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStaffId || !selectedDateStr) return;

    const staff = staffList.find((s) => s.id === selectedStaffId);
    if (!staff) return;

    let startTime = '08:00';
    let endTime = '16:00';
    let hours = 8;

    if (selectedShiftType === 'evening') {
      startTime = '16:00';
      endTime = '24:00';
      hours = 8;
    } else if (selectedShiftType === 'full') {
      startTime = '08:00';
      endTime = '20:00';
      hours = 12;
    } else if (selectedShiftType === 'off') {
      startTime = '-';
      endTime = '-';
      hours = 0;
    }

    const newEntry: ShiftRosterEntry = {
      id: `ros-${selectedStaffId}-${selectedDateStr}`,
      staffId: staff.id,
      staffName: staff.name,
      role: staff.role,
      dateStr: selectedDateStr,
      shiftType: selectedShiftType,
      startTime,
      endTime,
      estLaborCostCents: hours * staff.hourlyRateCents,
    };

    setRoster((prev) => {
      const filtered = prev.filter((r) => !(r.staffId === staff.id && r.dateStr === selectedDateStr));
      return [...filtered, newEntry];
    });

    setIsAssignModalOpen(false);
    playScannerSound('success');
    addToast({
      title: language === 'th' ? 'บันทึกตารางกะสำเร็จ' : 'Shift Scheduled',
      message: `${staff.name}: ${selectedShiftType.toUpperCase()} (${selectedDateStr})`,
      type: 'success',
    });
  };

  const totalEstLaborCostCents = weekDays.reduce((sum, day) => {
    const dayEntries = roster.filter((r) => r.dateStr === day.dateStr);
    return sum + dayEntries.reduce((s, r) => s + r.estLaborCostCents, 0);
  }, 0);

  return (
    <div className="space-y-4">
      {/* Week Navigation Header */}
      <div className="p-4 rounded-2xl bg-card border border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-primary/10 text-primary">
            <Calendar className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-text">
              {language === 'th' ? 'ตารางเวรจัดกะพนักงานประจำสัปดาห์ (Shift Roster)' : 'Weekly Employee Shift Roster'}
            </h3>
            <p className="text-xs text-text/60 mt-0.5">
              {weekDays[0].dateStr} — {weekDays[6].dateStr} · {language === 'th' ? 'ประมาณการค่าแรงสัปดาห์นี้:' : 'Est. Weekly Labor:'}{' '}
              <span className="font-mono tabular-nums font-bold text-primary">
                {formatMoney(createMoney(totalEstLaborCostCents, session.currentStore.currency || 'THB'))}
              </span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setCurrentWeekOffset((p) => p - 1)}
            className="p-2 rounded-xl border border-border bg-background hover:bg-card text-text cursor-pointer"
            title="Previous Week"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setCurrentWeekOffset(0)}
            className="px-3 py-1.5 rounded-xl border border-border bg-background hover:bg-card text-xs font-bold text-text cursor-pointer"
          >
            {language === 'th' ? 'สัปดาห์นี้' : 'Current Week'}
          </button>
          <button
            type="button"
            onClick={() => setCurrentWeekOffset((p) => p + 1)}
            className="p-2 rounded-xl border border-border bg-background hover:bg-card text-text cursor-pointer"
            title="Next Week"
          >
            <ChevronRight className="h-4 w-4" />
          </button>

          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              setSelectedDateStr(weekDays[0].dateStr);
              setSelectedStaffId(staffList[0]?.id || '');
              setIsAssignModalOpen(true);
            }}
            leftIcon={<Plus className="h-4 w-4" />}
          >
            {language === 'th' ? 'จัดกะพนักงาน' : 'Assign Shift'}
          </Button>
        </div>
      </div>

      {/* Roster Calendar Table */}
      <div className="w-full overflow-x-auto rounded-2xl border border-border bg-card shadow-2xs">
        <table className="w-full text-left text-xs border-collapse min-w-[700px]">
          <thead>
            <tr className="border-b border-border bg-background/50 font-bold text-text/70">
              <th className="py-3 px-4 w-48">{language === 'th' ? 'พนักงาน' : 'Staff Member'}</th>
              {weekDays.map((day) => (
                <th key={day.dateStr} className="py-3 px-2 text-center border-l border-border/40 min-w-[90px]">
                  <div className="text-[10px] uppercase text-brand-text-secondary">{language === 'th' ? day.dayLabelTh : day.dayLabelEn}</div>
                  <div className="font-mono tabular-nums text-xs font-bold text-text">{day.date.getDate()}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {staffList.map((staff) => (
              <tr key={staff.id} className="hover:bg-background/40 transition-colors">
                <td className="py-3 px-4 font-bold text-text">
                  <div className="font-bold text-xs text-text">{staff.name}</div>
                  <div className="text-[10px] text-brand-text-secondary font-mono tabular-nums">{staff.role}</div>
                </td>

                {weekDays.map((day) => {
                  const shift = roster.find((r) => r.staffId === staff.id && r.dateStr === day.dateStr);

                  return (
                    <td
                      key={day.dateStr}
                      onClick={() => {
                        setSelectedStaffId(staff.id);
                        setSelectedDateStr(day.dateStr);
                        setSelectedShiftType(shift?.shiftType || 'morning');
                        setIsAssignModalOpen(true);
                      }}
                      className="py-2 px-1 text-center border-l border-border/40 cursor-pointer hover:bg-primary/5 transition-colors"
                    >
                      {shift ? (
                        <div
                          className={`p-1.5 rounded-lg text-[10px] font-bold border font-mono tabular-nums ${
                            shift.shiftType === 'morning'
                              ? 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300'
                              : shift.shiftType === 'evening'
                              ? 'bg-brand-surface-selected border-primary/35 text-brand-text-accent'
                              : shift.shiftType === 'full'
                              ? 'bg-blue-500/10 border-blue-500/30 text-blue-700 dark:text-blue-300'
                              : 'bg-card border-border text-brand-text-secondary'
                          }`}
                        >
                          <div className="uppercase font-black">{shift.shiftType}</div>
                          <div className="text-[9px] opacity-80">{shift.startTime} - {shift.endTime}</div>
                        </div>
                      ) : (
                        <span className="text-[10px] text-brand-text-secondary font-mono tabular-nums hover:text-primary">+ {language === 'th' ? 'จัดกะ' : 'Assign'}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Assign Shift Modal */}
      <Modal
        isOpen={isAssignModalOpen}
        onClose={() => setIsAssignModalOpen(false)}
        title={language === 'th' ? 'กำหนดกะการทำงานพนักงาน' : 'Assign Employee Shift'}
        maxWidth="sm"
      >
        <form onSubmit={handleAssignShift} className="space-y-3.5">
          <div>
            <label className="block text-xs font-bold text-text/70 mb-1">
              {language === 'th' ? 'พนักงาน' : 'Staff Member'}
            </label>
            <select
              value={selectedStaffId}
              onChange={(e) => setSelectedStaffId(e.target.value)}
              className="w-full h-10 px-3 rounded-lg border border-border bg-background text-xs font-bold text-text"
            >
              {staffList.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.role})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-text/70 mb-1">
              {language === 'th' ? 'วันที่' : 'Date'}
            </label>
            <input
              type="date"
              value={selectedDateStr}
              onChange={(e) => setSelectedDateStr(e.target.value)}
              className="w-full h-10 px-3 rounded-lg border border-border bg-background text-xs font-mono tabular-nums font-bold text-text"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-text/70 mb-1">
              {language === 'th' ? 'ประเภทกะ' : 'Shift Type'}
            </label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { id: 'morning', label: language === 'th' ? 'เช้า (08:00 - 16:00)' : 'Morning Shift' },
                { id: 'evening', label: language === 'th' ? 'บ่าย/ค่ำ (16:00 - 24:00)' : 'Evening Shift' },
                { id: 'full', label: language === 'th' ? 'เต็มวัน (08:00 - 20:00)' : 'Full Day' },
                { id: 'off', label: language === 'th' ? 'วันหยุด (Day Off)' : 'Day Off' },
              ].map((st) => (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => setSelectedShiftType(st.id as any)}
                  className={`p-2.5 rounded-lg border text-xs font-bold text-left transition-all cursor-pointer ${
                    selectedShiftType === st.id
                      ? 'border-primary bg-primary/10 text-primary ring-1 ring-primary'
                      : 'border-border bg-background text-text/70 hover:text-text'
                  }`}
                >
                  {st.label}
                </button>
              ))}
            </div>
          </div>

          <div className="pt-2 flex justify-end gap-2">
            <Button variant="secondary" size="md" onClick={() => setIsAssignModalOpen(false)}>
              {language === 'th' ? 'ยกเลิก' : 'Cancel'}
            </Button>
            <Button variant="primary" size="md" type="submit">
              {language === 'th' ? 'บันทึกตารางกะ' : 'Save Shift'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
