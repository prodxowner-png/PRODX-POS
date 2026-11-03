import React, { useState } from 'react';
import {
  CheckCircle2,
  Circle,
  Plus,
  Trash2,
  Loader2,
  LogOut,
  User as UserIcon,
  Search,
  Filter,
  Calendar,
  AlertCircle,
  Layout,
  CheckCircle,
  Clock,
  ChevronRight,
  ShieldCheck,
} from 'lucide-react';
import { useTasks } from '../../hooks/useTasks';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useLanguage } from '../../context/LanguageContext';
import { motion, AnimatePresence } from 'framer-motion';

export default function TaskManagementScreen() {
  const { tasks, loading, error, addTask, updateTaskStatus, deleteTask } = useTasks();
  const { session, logout } = useAuth();
  const { addToast } = useToast();
  const { language } = useLanguage();
  const isThai = language === 'th';

  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [filter, setFilter] = useState<'all' | 'active' | 'completed'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const handleSignOut = async () => {
    try {
      await logout();
      addToast({
        type: 'info',
        title: isThai ? 'ออกจากระบบแล้ว' : 'Signed Out',
        message: isThai ? 'เซสชันของคุณสิ้นสุดลงแล้ว' : 'Your session has ended',
      });
    } catch (err: any) {
      addToast({
        type: 'error',
        title: isThai ? 'ออกจากระบบไม่สำเร็จ' : 'Sign-out Failed',
        message: err.message,
      });
    }
  };

  const handleAddTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    setIsAdding(true);
    try {
      await addTask(newTitle, newDesc);
      setNewTitle('');
      setNewDesc('');
      addToast({
        type: 'success',
        title: isThai ? 'เพิ่มงานสำเร็จ' : 'Task Added',
        message: isThai ? 'บันทึกงานใหม่เรียบร้อยแล้ว' : 'Your new task has been saved',
      });
    } catch (err: any) {
      addToast({
        type: 'error',
        title: isThai ? 'เพิ่มงานไม่สำเร็จ' : 'Failed to Add Task',
        message: err.message,
      });
    } finally {
      setIsAdding(false);
    }
  };

  const filteredTasks = tasks
    .filter((t) => {
      if (filter === 'active') return !t.completed;
      if (filter === 'completed') return t.completed;
      return true;
    })
    .filter((t) =>
      t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (t.description || '').toLowerCase().includes(searchQuery.toLowerCase())
    );

  if (!session) {
    return (
      <div className="min-h-[80vh] flex flex-col items-center justify-center p-6 text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full bg-card p-8 rounded-3xl border border-border border-crisp shadow-xl space-y-8"
        >
          <div className="w-20 h-20 bg-indigo-500/10 rounded-3xl flex items-center justify-center mx-auto text-indigo-500">
            <Layout className="w-10 h-10" />
          </div>
          <div className="space-y-2">
            <h1 className="text-3xl font-black text-text tracking-tight">
              {isThai ? 'ระบบจัดการงาน' : 'Task Manager'}
            </h1>
            <p className="text-text/60 font-medium">
              {isThai
                ? 'กรุณาเข้าสู่ระบบ POS ก่อน เพื่อจัดการงานส่วนตัวของคุณ'
                : 'Sign in through the PRODX POS login before managing your personal tasks'}
            </p>
          </div>
          <p className="text-sm text-text/60">{isThai ? 'ใช้หน้าล็อกอินของ PRODX POS เพื่อยืนยันตัวตน' : 'Use the PRODX POS login to authenticate.'}</p>
          <div className="flex items-center gap-2 justify-center text-[11px] text-text/40 font-mono uppercase tracking-widest">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Enterprise Security Enabled</span>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 lg:p-8 space-y-8">
      {/* Header section */}
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 pb-6 border-b border-border border-crisp">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-indigo-500 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-indigo-500/20">
            <Layout className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-text tracking-tight">
              {isThai ? 'งานของฉัน' : 'My Personal Tasks'}
            </h1>
            <div className="flex items-center gap-2 text-xs text-text/60 font-medium mt-0.5">
              <UserIcon className="w-3.5 h-3.5 text-indigo-500" />
              <span>{session.currentUser.email}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden md:flex flex-col items-end mr-2">
            <div className="text-[10px] font-bold text-text/40 uppercase tracking-widest leading-none mb-1">Session Data</div>
            <div className="text-[11px] font-mono text-emerald-500 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
              Real-time Sync Active
            </div>
          </div>
          <button
            onClick={handleSignOut}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border bg-card hover:bg-rose-500/10 hover:border-rose-500/30 hover:text-rose-500 transition-all text-sm font-bold text-text/70 cursor-pointer active:scale-95"
          >
            <LogOut className="w-4 h-4" />
            <span>{isThai ? 'ออกจากระบบ' : 'Sign Out'}</span>
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column: Form & Filters */}
        <aside className="lg:col-span-4 space-y-6">
          <section className="bg-card p-6 rounded-3xl border border-border border-crisp shadow-sm space-y-6">
            <h2 className="text-sm font-black text-text/40 uppercase tracking-widest flex items-center gap-2">
              <Plus className="w-4 h-4 text-indigo-500" />
              {isThai ? 'เพิ่มงานใหม่' : 'Create New Task'}
            </h2>
            <form onSubmit={handleAddTask} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-text/60 ml-1">{isThai ? 'หัวข้องาน' : 'Task Title'}</label>
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder={isThai ? 'จะทำอะไรดี?' : 'What needs to be done?'}
                  className="w-full bg-background border border-border rounded-xl px-4 py-3 text-sm focus:outline-hidden focus:ring-2 focus:ring-indigo-500 transition-all placeholder:text-text/30"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-text/60 ml-1">{isThai ? 'รายละเอียด (ระบุหรือไม่ก็ได้)' : 'Description (Optional)'}</label>
                <textarea
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder={isThai ? 'โน้ตเพิ่มเติม...' : 'Add some notes...'}
                  className="w-full bg-background border border-border rounded-xl px-4 py-3 text-sm focus:outline-hidden focus:ring-2 focus:ring-indigo-500 transition-all min-h-[100px] resize-none placeholder:text-text/30"
                />
              </div>
              <button
                type="submit"
                disabled={isAdding || !newTitle.trim()}
                className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-400 text-white font-bold py-3.5 px-6 rounded-2xl transition-all shadow-lg shadow-indigo-600/20 flex items-center justify-center gap-2 cursor-pointer active:scale-95"
              >
                {isAdding ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <>
                    <Plus className="w-5 h-5" />
                    <span>{isThai ? 'บันทึกงาน' : 'Save Task'}</span>
                  </>
                )}
              </button>
            </form>
          </section>

          <section className="bg-card p-6 rounded-3xl border border-border border-crisp shadow-sm space-y-6">
            <h2 className="text-sm font-black text-text/40 uppercase tracking-widest flex items-center gap-2">
              <Filter className="w-4 h-4 text-indigo-500" />
              {isThai ? 'ตัวกรอง' : 'Filter & Search'}
            </h2>
            <div className="space-y-4">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text/40" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={isThai ? 'ค้นหางาน...' : 'Search tasks...'}
                  className="w-full bg-background border border-border rounded-xl pl-10 pr-4 py-2.5 text-xs focus:outline-hidden focus:ring-1 focus:ring-indigo-500"
                />
              </div>
              <div className="grid grid-cols-3 gap-2">
                {(['all', 'active', 'completed'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`py-2 px-1 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all border ${
                      filter === f
                        ? 'bg-indigo-500 text-white border-indigo-500'
                        : 'bg-background text-text/60 border-border hover:bg-accent'
                    }`}
                  >
                    {isThai
                      ? f === 'all' ? 'ทั้งหมด' : f === 'active' ? 'รอดำเนินการ' : 'เสร็จสิ้น'
                      : f}
                  </button>
                ))}
              </div>
            </div>
          </section>
        </aside>

        {/* Right Column: Task List */}
        <main className="lg:col-span-8 space-y-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-bold text-text/40 uppercase tracking-widest">
              {isThai ? `พบ ${filteredTasks.length} รายการ` : `Found ${filteredTasks.length} tasks`}
            </div>
            <div className="flex items-center gap-4 text-[10px] font-mono text-text/40 uppercase">
              <span className="flex items-center gap-1.5">
                <Circle className="w-2.5 h-2.5 text-indigo-500" />
                {tasks.filter(t => !t.completed).length} Pending
              </span>
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="w-2.5 h-2.5 text-emerald-500" />
                {tasks.filter(t => t.completed).length} Done
              </span>
            </div>
          </div>

          <div className="space-y-4 min-h-[400px]">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-20 space-y-4">
                <Loader2 className="w-10 h-10 text-indigo-500 animate-spin" />
                <p className="text-sm font-medium text-text/40">{isThai ? 'กำลังโหลดข้อมูล...' : 'Synchronizing with Cloud...'}</p>
              </div>
            ) : filteredTasks.length === 0 ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col items-center justify-center py-20 bg-card rounded-3xl border border-dashed border-border text-center space-y-4"
              >
                <div className="w-16 h-16 bg-background rounded-full flex items-center justify-center text-slate-400">
                  {searchQuery ? <Search className="w-8 h-8" /> : <Layout className="w-8 h-8" />}
                </div>
                <div className="space-y-1">
                  <h3 className="font-bold text-text">
                    {searchQuery
                      ? (isThai ? 'ไม่พบงานที่ค้นหา' : 'No results found')
                      : (isThai ? 'ยังไม่มีงานในรายการ' : 'No tasks yet')}
                  </h3>
                  <p className="text-xs text-text/40">
                    {searchQuery
                      ? (isThai ? 'ลองเปลี่ยนคำค้นหาดูใหม่' : 'Try adjusting your search query')
                      : (isThai ? 'เริ่มเพิ่มงานแรกของคุณได้เลย!' : 'Get started by creating your first task!')}
                  </p>
                </div>
              </motion.div>
            ) : (
              <AnimatePresence mode="popLayout">
                {filteredTasks.map((task) => (
                  <motion.div
                    key={task.id}
                    layout
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className={`group bg-card p-5 rounded-2xl border transition-all duration-300 flex items-start justify-between gap-4 shadow-sm hover:shadow-md ${
                      task.completed ? 'border-border/50 bg-slate-50/50 dark:bg-slate-900/30' : 'border-border border-crisp hover:border-indigo-500/30'
                    }`}
                  >
                    <div className="flex items-start gap-4 min-w-0">
                      <button
                        onClick={() => updateTaskStatus(task.id, !task.completed)}
                        className={`mt-1 shrink-0 w-6 h-6 rounded-lg flex items-center justify-center transition-all cursor-pointer ${
                          task.completed
                            ? 'bg-emerald-500 text-white'
                            : 'bg-background border-2 border-border text-transparent hover:border-indigo-500'
                        }`}
                      >
                        {task.completed ? <CheckCircle2 className="w-4 h-4" /> : <Circle className="w-4 h-4" />}
                      </button>
                      <div className="min-w-0">
                        <h3 className={`font-bold text-base transition-all ${task.completed ? 'text-text/40 line-through' : 'text-text'}`}>
                          {task.title}
                        </h3>
                        {task.description && (
                          <p className={`text-xs mt-1 transition-all ${task.completed ? 'text-text/30' : 'text-text/60'}`}>
                            {task.description}
                          </p>
                        )}
                        <div className="flex items-center gap-3 mt-3">
                          <div className="flex items-center gap-1.5 text-[10px] font-bold text-text/40 uppercase tracking-widest">
                            <Clock className="w-3.5 h-3.5" />
                            <span>{new Date(task.updatedAt).toLocaleDateString()}</span>
                          </div>
                          {task.completed && (
                            <div className="flex items-center gap-1.5 text-[10px] font-bold text-emerald-500 uppercase tracking-widest">
                              <CheckCircle className="w-3.5 h-3.5" />
                              <span>Completed</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => deleteTask(task.id)}
                      className="opacity-0 group-hover:opacity-100 p-2 rounded-xl text-text/40 hover:text-rose-500 hover:bg-rose-500/10 transition-all cursor-pointer"
                      title={isThai ? 'ลบงาน' : 'Delete task'}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </motion.div>
                ))}
              </AnimatePresence>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
