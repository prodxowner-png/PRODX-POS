/**
 * PRODX POS - Browser notification settings. Remote push delivery is not configured.
 */

import React, { useState, useEffect } from 'react';
import { Bell, BellRing, CheckCircle2, AlertTriangle, ShieldAlert, Loader2 } from 'lucide-react';
import { Button } from '../common/Button';
import { Badge } from '../common/Badge';
import { Card, CardHeader, CardBody, CardTitle, CardDescription } from '../common/Card';
import { useToast } from '../../context/ToastContext';
import { useLanguage } from '../../context/LanguageContext';

export const FcmNotificationWidget: React.FC = () => {
  const { addToast } = useToast();
  const { language } = useLanguage();
  const isThai = language === 'th';


  const [loading, setLoading] = useState(false);
  const [permissionState, setPermissionState] = useState<NotificationPermission>('default');

  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setPermissionState(Notification.permission);
    }
  }, []);

  const handleEnableNotifications = async () => {
    setLoading(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        setPermissionState('granted');
        addToast({
          title: isThai ? 'เปิดใช้งานการแจ้งเตือนสำเร็จ' : 'Browser Notifications Enabled',
          message: isThai ? 'POS พร้อมรับการแจ้งเตือนสต็อกต่ำและการอนุมัติผู้จัดการแบบเรียลไทม์' : 'This browser can display local test notifications. Remote push is not configured.',
          type: 'success',
        });
      } else {
        setPermissionState(Notification.permission);
        addToast({
          title: isThai ? 'ไม่อนุญาตการแจ้งเตือน' : 'Permission Denied',
          message: isThai ? 'โปรดอนุญาตการแจ้งเตือนในเบราว์เซอร์เพื่อรับการแจ้งเตือน' : 'Please enable notification permissions in your browser settings.',
          type: 'warning',
        });
      }
    } catch (err: any) {
      addToast({
        title: isThai ? 'เกิดข้อผิดพลาด' : 'Error',
        message: err.message || 'Failed to enable browser notifications.',
        type: 'error',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSimulateAlert = (type: 'stock' | 'approval') => {
    if (type === 'stock') {
      addToast({
        title: isThai ? '⚠️ แจ้งเตือนสต็อกต่ำ (Low Stock Alert)' : '⚠️ Low Stock Alert (Local Test)',
        message: isThai ? 'สินค้า "Double Espresso" เหลือเพียง 8 ชิ้น (ต่ำกว่าจุด Reorder Point)' : 'Product "Double Espresso" is low on stock (8 units remaining).',
        type: 'warning',
      });
      if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
        new Notification(isThai ? 'แจ้งเตือนสต็อกต่ำ (ทดสอบ)' : 'Low Stock Alert (Test)', { body: isThai ? 'นี่คือการแจ้งเตือนทดสอบในเบราว์เซอร์ ไม่ใช่ข้อมูลสต็อกจริง' : 'Local browser test only; this is not live inventory data.' });
      }
    } else {
      addToast({
        title: isThai ? '🔔 คำขออนุมัติผู้จัดการ (Manager Approval)' : '🔔 Manager Approval Request (Local Test)',
        message: isThai ? 'แคชเชียร์ขออนุมัติยกเลิกคำสั่งซื้อ #ORD-0904-0042 (฿2,354.00)' : 'Cashier requested supervisor approval for voiding order #ORD-0904-0042.',
        type: 'info',
      });
      if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
        new Notification(isThai ? 'คำขออนุมัติ (ทดสอบ)' : 'Approval Request (Test)', { body: isThai ? 'นี่คือการแจ้งเตือนทดสอบ ไม่ใช่คำขออนุมัติจริง' : 'Local browser test only; this is not a real approval request.' });
      }
    }
  };

  return (
    <Card className="bg-card border-border shadow-xs">
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <BellRing className="w-5 h-5 text-primary" />
              <span>{isThai ? 'การแจ้งเตือนของเบราว์เซอร์' : 'Browser Notifications (Local Only)'}</span>
            </CardTitle>
            <CardDescription>
              {isThai ? 'เปิดการแจ้งเตือนในเบราว์เซอร์เพื่อทดสอบเท่านั้น การแจ้งเตือนระยะไกลถูกปิดใช้งาน' : 'Enable browser notifications for local tests only. Remote push delivery is retired.'}
            </CardDescription>
          </div>
          <Badge variant={permissionState === 'granted' ? 'success' : 'neutral'}>
            {permissionState === 'granted' ? (isThai ? 'เปิดใช้งานแล้ว' : 'Active') : (isThai ? 'ยังไม่เปิดใช้งาน' : 'Inactive')}
          </Badge>
        </div>
      </CardHeader>
      <CardBody className="space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 rounded-xl bg-slate-900/40 border border-slate-800">
          <div className="flex items-center space-x-3">
            <div className={`p-2.5 rounded-xl ${permissionState === 'granted' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'}`}>
              <Bell className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-bold text-white">
                {permissionState === 'granted' ? (isThai ? 'อนุญาตการแจ้งเตือนในเบราว์เซอร์แล้ว' : 'Browser Notifications Allowed') : (isThai ? 'อนุญาตการแจ้งเตือนของเบราว์เซอร์' : 'Enable Browser Notifications')}
              </p>
              <p className="text-xs text-slate-400 mt-0.5">
                {isThai ? 'ใช้สำหรับทดสอบการแจ้งเตือนในเครื่องเท่านั้น ไม่มีการรับ push จากเซิร์ฟเวอร์' : 'Local notification tests only; server push is not enabled.'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {permissionState !== 'granted' ? (
              <Button variant="primary" size="sm" onClick={handleEnableNotifications} disabled={loading}>
                {loading && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                {isThai ? 'เปิดใช้งานการแจ้งเตือน' : 'Enable Notifications'}
              </Button>
            ) : (
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => handleSimulateAlert('stock')} className="text-xs">
                  {isThai ? 'ทดสอบแจ้งเตือนสต็อก' : 'Test Stock Alert'}
                </Button>
                <Button variant="outline" size="sm" onClick={() => handleSimulateAlert('approval')} className="text-xs">
                  {isThai ? 'ทดสอบขออนุมัติ' : 'Test Approval'}
                </Button>
              </div>
            )}
          </div>
        </div>
      </CardBody>
    </Card>
  );
};
