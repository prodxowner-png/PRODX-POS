import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  X,
  Check,
  RotateCcw,
  ArrowRight,
  Clock,
  Sparkles,
} from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { getStoreDateCarrier } from './utils/storeTime';

export interface DateRange {
  startDate: Date;
  endDate: Date;
}

export type DateRangePreset =
  | 'today'
  | 'yesterday'
  | 'last7days'
  | 'last30days'
  | 'thisMonth'
  | 'custom';

export interface DateRangePickerProps {
  value: DateRange;
  onChange: (range: DateRange) => void;
  className?: string;
  id?: string;
  timeZone?: string;
}

// Helpers for date calculations
function startOfDay(d: Date): Date {
  const res = new Date(d);
  res.setHours(0, 0, 0, 0);
  return res;
}

function endOfDay(d: Date): Date {
  const res = new Date(d);
  res.setHours(23, 59, 59, 999);
  return res;
}

function isSameDay(d1: Date, d2: Date): boolean {
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

function isDateInRange(date: Date, start: Date, end: Date): boolean {
  const d = startOfDay(date).getTime();
  const s = startOfDay(start).getTime();
  const e = startOfDay(end).getTime();
  return d >= s && d <= e;
}

function formatDisplayDate(date: Date, lang: string): string {
  if (lang === 'th') {
    const months = [
      'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
      'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
    ];
    return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear() + 543}`;
  }
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  return `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

export const DateRangePicker: React.FC<DateRangePickerProps> = ({
  value,
  onChange,
  className = '',
  id = 'report-date-range-picker',
  timeZone = 'UTC',
}) => {
  const { language } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);

  // Temporary selection state when the picker is open
  const [tempStart, setTempStart] = useState<Date>(value.startDate);
  const [tempEnd, setTempEnd] = useState<Date>(value.endDate);
  const [hoverDate, setHoverDate] = useState<Date | null>(null);
  const [selectionStep, setSelectionStep] = useState<'start' | 'end'>('start');

  // Month being viewed in the calendar
  const [viewMonth, setViewMonth] = useState<Date>(() => new Date(value.endDate));

  // Container ref for click-outside
  const containerRef = useRef<HTMLDivElement>(null);

  // Sync temp state with incoming value
  useEffect(() => {
    setTempStart(value.startDate);
    setTempEnd(value.endDate);
  }, [value, timeZone]);

  // Click outside listener
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Determine which preset matches the current value
  const activePreset = useMemo<DateRangePreset>(() => {
    const now = getStoreDateCarrier(new Date(), timeZone);
    const todayStart = startOfDay(now);
    const todayEnd = endOfDay(now);

    const s = startOfDay(value.startDate).getTime();
    const e = startOfDay(value.endDate).getTime();

    // Today
    if (s === todayStart.getTime() && e === todayStart.getTime()) {
      return 'today';
    }

    // Yesterday
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const yStart = startOfDay(yesterday).getTime();
    if (s === yStart && e === yStart) {
      return 'yesterday';
    }

    // Last 7 days
    const l7 = new Date(now);
    l7.setDate(now.getDate() - 6);
    if (s === startOfDay(l7).getTime() && e === todayStart.getTime()) {
      return 'last7days';
    }

    // Last 30 days
    const l30 = new Date(now);
    l30.setDate(now.getDate() - 29);
    if (s === startOfDay(l30).getTime() && e === todayStart.getTime()) {
      return 'last30days';
    }

    // This Month
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    if (s === startOfDay(thisMonthStart).getTime() && e === todayStart.getTime()) {
      return 'thisMonth';
    }

    return 'custom';
  }, [value]);

  // Presets configuration
  const presets: { id: DateRangePreset; labelTh: string; labelEn: string; getRange: () => DateRange }[] = [
    {
      id: 'today',
      labelTh: 'วันนี้',
      labelEn: 'Today',
      getRange: () => {
        const now = getStoreDateCarrier(new Date(), timeZone);
        return { startDate: startOfDay(now), endDate: endOfDay(now) };
      },
    },
    {
      id: 'yesterday',
      labelTh: 'เมื่อวาน',
      labelEn: 'Yesterday',
      getRange: () => {
        const d = getStoreDateCarrier(new Date(), timeZone);
        d.setDate(d.getDate() - 1);
        return { startDate: startOfDay(d), endDate: endOfDay(d) };
      },
    },
    {
      id: 'last7days',
      labelTh: '7 วันล่าสุด',
      labelEn: 'Last 7 Days',
      getRange: () => {
        const now = getStoreDateCarrier(new Date(), timeZone);
        const start = new Date(now);
        start.setDate(now.getDate() - 6);
        return { startDate: startOfDay(start), endDate: endOfDay(now) };
      },
    },
    {
      id: 'last30days',
      labelTh: '30 วันล่าสุด',
      labelEn: 'Last 30 Days',
      getRange: () => {
        const now = getStoreDateCarrier(new Date(), timeZone);
        const start = new Date(now);
        start.setDate(now.getDate() - 29);
        return { startDate: startOfDay(start), endDate: endOfDay(now) };
      },
    },
    {
      id: 'thisMonth',
      labelTh: 'เดือนนี้',
      labelEn: 'This Month',
      getRange: () => {
        const now = getStoreDateCarrier(new Date(), timeZone);
        const start = new Date(now.getFullYear(), now.getMonth(), 1);
        return { startDate: startOfDay(start), endDate: endOfDay(now) };
      },
    },
  ];

  const handleApplyPreset = (preset: DateRangePreset) => {
    const found = presets.find((p) => p.id === preset);
    if (found) {
      const range = found.getRange();
      setTempStart(range.startDate);
      setTempEnd(range.endDate);
      onChange(range);
      setIsOpen(false);
    }
  };

  // Month navigation
  const prevMonth = () => {
    setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1));
  };

  const nextMonth = () => {
    setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1));
  };

  // Calendar days generation
  const calendarDays = useMemo(() => {
    const year = viewMonth.getFullYear();
    const month = viewMonth.getMonth();

    const firstDayIndex = new Date(year, month, 1).getDay(); // 0 = Sunday
    const daysInCurrentMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();

    const days: { date: Date; isCurrentMonth: boolean }[] = [];

    // Prev month padding
    for (let i = firstDayIndex - 1; i >= 0; i--) {
      days.push({
        date: new Date(year, month - 1, daysInPrevMonth - i),
        isCurrentMonth: false,
      });
    }

    // Current month days
    for (let i = 1; i <= daysInCurrentMonth; i++) {
      days.push({
        date: new Date(year, month, i),
        isCurrentMonth: true,
      });
    }

    // Next month padding to complete standard 35 or 42 grid
    const totalSlots = days.length > 35 ? 42 : 35;
    const remaining = totalSlots - days.length;
    for (let i = 1; i <= remaining; i++) {
      days.push({
        date: new Date(year, month + 1, i),
        isCurrentMonth: false,
      });
    }

    return days;
  }, [viewMonth]);

  // Click on a calendar day
  const handleDayClick = (date: Date) => {
    if (selectionStep === 'start') {
      setTempStart(startOfDay(date));
      setTempEnd(endOfDay(date));
      setSelectionStep('end');
    } else {
      // Step is 'end'
      if (date < tempStart) {
        // If clicked day is before tempStart, treat as new start
        setTempStart(startOfDay(date));
        setTempEnd(endOfDay(date));
        setSelectionStep('end');
      } else {
        setTempEnd(endOfDay(date));
        setSelectionStep('start');
      }
    }
  };

  const handleApply = () => {
    onChange({
      startDate: startOfDay(tempStart),
      endDate: endOfDay(tempEnd),
    });
    setIsOpen(false);
  };

  const handleResetToToday = () => {
    handleApplyPreset('today');
  };

  const daysDifference = useMemo(() => {
    const s = startOfDay(tempStart).getTime();
    const e = startOfDay(tempEnd).getTime();
    const diffDays = Math.round(Math.abs((e - s) / (24 * 60 * 60 * 1000))) + 1;
    return diffDays;
  }, [tempStart, tempEnd]);

  // Day names
  const dayNamesEn = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  const dayNamesTh = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
  const dayNames = language === 'th' ? dayNamesTh : dayNamesEn;

  // Month & Year display text
  const monthYearLabel = useMemo(() => {
    const monthIndex = viewMonth.getMonth();
    const year = viewMonth.getFullYear();
    if (language === 'th') {
      const monthNamesTh = [
        'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
        'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
      ];
      return `${monthNamesTh[monthIndex]} ${year + 543}`;
    }
    const monthNamesEn = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ];
    return `${monthNamesEn[monthIndex]} ${year}`;
  }, [viewMonth, language]);

  return (
    <div id={id} ref={containerRef} className={`relative inline-block ${className}`}>
      {/* Trigger Button - New SaaS Design: rounded-lg, 1px border, min 44px touch target */}
      <button
        type="button"
        onClick={() => {
          setTempStart(value.startDate);
          setTempEnd(value.endDate);
          setViewMonth(new Date(value.endDate));
          setSelectionStep('start');
          setIsOpen(!isOpen);
        }}
        className={`min-h-[44px] px-3.5 py-2 rounded-lg border-crisp flex items-center justify-between gap-3 text-xs font-medium transition-all cursor-pointer select-none shadow-2xs focus:outline-none focus:ring-2 focus:ring-primary/40 ${
          isOpen
            ? 'border-primary bg-primary/10 text-primary'
            : 'border-border bg-card text-text hover:bg-background hover:border-border'
        }`}
        aria-expanded={isOpen}
        aria-label="Filter report date range"
      >
        <div className="flex items-center gap-2">
          <div className="p-1 rounded-md bg-primary/10 text-primary">
            <CalendarIcon className="h-4 w-4" />
          </div>

          <div className="flex items-center gap-2">
            {/* Active Preset Pill */}
            {activePreset !== 'custom' ? (
              <span className="px-2 py-0.5 rounded-md bg-primary text-white font-mono text-[10px] font-bold uppercase tracking-wider">
                {presets.find((p) => p.id === activePreset)?.[language === 'th' ? 'labelTh' : 'labelEn']}
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded-md bg-card border border-border text-text/70 font-mono text-[10px] font-bold uppercase tracking-wider">
                {language === 'th' ? 'กำหนดเอง' : 'Custom'}
              </span>
            )}

            {/* Date Range Text */}
            <span className="font-mono font-bold text-text whitespace-nowrap">
              {formatDisplayDate(value.startDate, language)} - {formatDisplayDate(value.endDate, language)}
            </span>
          </div>
        </div>

        <ChevronDown
          className={`h-4 w-4 text-text/50 transition-transform duration-200 ${
            isOpen ? 'rotate-180 text-primary' : ''
          }`}
        />
      </button>

      {/* Popover / Dialog Modal */}
      {isOpen && (
        <div className="fixed sm:absolute inset-x-3 sm:inset-x-auto top-20 sm:top-full sm:left-0 sm:mt-2 z-50 rounded-lg border-border border-crisp bg-card shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 w-auto sm:w-[480px] max-w-[95vw]">
          {/* Header Bar */}
          <div className="px-4 py-3 border-b border-border flex items-center justify-between bg-card">
            <div>
              <h3 className="text-xs font-bold text-text flex items-center gap-1.5">
                <CalendarIcon className="h-3.5 w-3.5 text-primary" />
                <span>{language === 'th' ? 'เลือกระยะเวลารายงาน' : 'Select Report Date Range'}</span>
              </h3>
              <p className="text-[11px] text-text/70">
                {language === 'th'
                  ? 'แตะเลือกวันเริ่มต้นและวันสิ้นสุดเพื่อคำนวณยอดขาย'
                  : 'Tap start and end dates to filter metrics & transactions'}
              </p>
            </div>

            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="min-h-[36px] min-w-[36px] p-1.5 rounded-lg border-border border-crisp hover:bg-background text-text/70 hover:text-text transition-colors cursor-pointer flex items-center justify-center"
              aria-label="Close date range picker"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="p-4 space-y-4">
            {/* Quick Presets Strip - Touch-optimized with 40-44px targets */}
            <div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-text/50 font-bold mb-1.5">
                {language === 'th' ? 'ช่วงเวลายอดนิยม' : 'Quick Presets'}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                {presets.map((p) => {
                  const isCurrent = activePreset === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handleApplyPreset(p.id)}
                      className={`min-h-[42px] px-3 py-1.5 rounded-lg border-crisp text-xs font-semibold transition-all cursor-pointer flex items-center justify-center gap-1.5 select-none ${
                        isCurrent
                          ? 'border-primary bg-primary text-white font-bold shadow-2xs'
                          : 'border-border bg-background text-text/80 hover:bg-card hover:border-border'
                      }`}
                    >
                      {isCurrent && <Check className="h-3 w-3 shrink-0" />}
                      <span className="truncate">{language === 'th' ? p.labelTh : p.labelEn}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Selection Visual Feedback Display */}
            <div className="p-2.5 rounded-lg border-border border-crisp bg-background flex items-center justify-between gap-2">
              {/* Start Date Box */}
              <div
                className={`flex-1 p-2 rounded-lg border-crisp text-center transition-colors ${
                  selectionStep === 'start'
                    ? 'border-primary bg-primary/10 text-primary ring-1 ring-primary'
                    : 'border-border bg-card'
                }`}
              >
                <div className="text-[10px] uppercase font-mono font-semibold text-text/50">
                  {language === 'th' ? 'วันเริ่มต้น (Start)' : 'Start Date'}
                </div>
                <div className="text-xs font-bold font-mono text-text mt-0.5">
                  {formatDisplayDate(tempStart, language)}
                </div>
              </div>

              <div className="text-text/50 shrink-0">
                <ArrowRight className="h-4 w-4" />
              </div>

              {/* End Date Box */}
              <div
                className={`flex-1 p-2 rounded-lg border-crisp text-center transition-colors ${
                  selectionStep === 'end'
                    ? 'border-primary bg-primary/10 text-primary ring-1 ring-primary'
                    : 'border-border bg-card'
                }`}
              >
                <div className="text-[10px] uppercase font-mono font-semibold text-text/50">
                  {language === 'th' ? 'วันสิ้นสุด (End)' : 'End Date'}
                </div>
                <div className="text-xs font-bold font-mono text-text mt-0.5">
                  {formatDisplayDate(tempEnd, language)}
                </div>
              </div>
            </div>

            {/* Interactive Calendar Month Navigation */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <button
                  type="button"
                  onClick={prevMonth}
                  className="min-h-[44px] min-w-[44px] rounded-lg border-border border-crisp bg-card hover:bg-background text-text flex items-center justify-center cursor-pointer active:scale-95 transition-all"
                  aria-label="Previous month"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>

                <div className="text-xs sm:text-sm font-bold font-mono text-text text-center">
                  {monthYearLabel}
                </div>

                <button
                  type="button"
                  onClick={nextMonth}
                  className="min-h-[44px] min-w-[44px] rounded-lg border-border border-crisp bg-card hover:bg-background text-text flex items-center justify-center cursor-pointer active:scale-95 transition-all"
                  aria-label="Next month"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>

              {/* Day of Week Header */}
              <div className="grid grid-cols-7 gap-1 text-center mb-1">
                {dayNames.map((name, i) => (
                  <div
                    key={name + i}
                    className="text-[10px] font-mono font-bold text-text/50 py-1"
                  >
                    {name}
                  </div>
                ))}
              </div>

              {/* Calendar Days Matrix - Touch-friendly minimum 40-44px targets */}
              <div className="grid grid-cols-7 gap-y-1">
                {calendarDays.map(({ date, isCurrentMonth }, idx) => {
                  const isStart = isSameDay(date, tempStart);
                  const isEnd = isSameDay(date, tempEnd);
                  const inRange = isDateInRange(date, tempStart, tempEnd);
                  const isToday = isSameDay(date, getStoreDateCarrier(new Date(), timeZone));

                  // Hover styling when selecting end date
                  const inHoverRange =
                    selectionStep === 'end' &&
                    hoverDate &&
                    hoverDate >= tempStart &&
                    isDateInRange(date, tempStart, hoverDate);

                  let cellClasses = 'text-text/80 hover:bg-background';
                  let containerBg = '';

                  if (isStart && isEnd) {
                    cellClasses = 'bg-primary text-white font-bold rounded-lg shadow-2xs';
                  } else if (isStart) {
                    cellClasses = 'bg-primary text-white font-bold rounded-l-lg shadow-2xs';
                    containerBg = 'bg-primary/10 rounded-l-lg';
                  } else if (isEnd) {
                    cellClasses = 'bg-primary text-white font-bold rounded-r-lg shadow-2xs';
                    containerBg = 'bg-primary/10 rounded-r-lg';
                  } else if (inRange || inHoverRange) {
                    cellClasses = 'bg-primary/10 text-primary font-semibold';
                    containerBg = 'bg-primary/10';
                  }

                  if (!isCurrentMonth) {
                    cellClasses += ' opacity-30';
                  }

                  return (
                    <div key={idx} className={`p-0.5 ${containerBg}`}>
                      <button
                        type="button"
                        onClick={() => handleDayClick(date)}
                        onMouseEnter={() => setHoverDate(date)}
                        className={`w-full min-h-[40px] sm:min-h-[42px] h-10 sm:h-11 flex flex-col items-center justify-center text-xs font-mono font-medium transition-colors cursor-pointer select-none active:scale-95 ${cellClasses}`}
                      >
                        <span>{date.getDate()}</span>
                        {isToday && !isStart && !isEnd && (
                          <span className="w-1 h-1 rounded-full bg-primary mt-0.5" />
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Footer Action Bar */}
          <div className="p-3.5 border-t border-border bg-card flex items-center justify-between gap-2">
            <div className="text-xs text-text/70 font-mono">
              <span className="font-bold text-text">{daysDifference}</span>{' '}
              {language === 'th' ? 'วัน' : daysDifference === 1 ? 'day' : 'days'}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleResetToToday}
                className="min-h-[44px] px-3 py-1.5 rounded-lg border-border border-crisp bg-card hover:bg-background text-text/80 text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{language === 'th' ? 'รีเซ็ตวันนี้' : 'Today'}</span>
              </button>

              <button
                type="button"
                onClick={handleApply}
                className="min-h-[44px] px-5 py-1.5 rounded-lg bg-primary hover:bg-primary-hover active:bg-primary-active text-white text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 shadow-2xs"
              >
                <Check className="h-4 w-4" />
                <span>{language === 'th' ? 'ใช้งานช่วงเวลานี้' : 'Apply Range'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
