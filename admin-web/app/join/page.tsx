'use client';

import { useEffect } from 'react';

export default function JoinVipPage() {
  useEffect(() => {
    const vipLink = process.env.NEXT_PUBLIC_VIP_LINK || "https://t.me/addlist/5jSQcywQEv44MjQ0";
    
    if (typeof window !== 'undefined') {
      const tg = (window as any).Telegram?.WebApp;
      if (tg) {
        tg.ready();
        tg.expand();
        if (tg.openTelegramLink) {
          tg.openTelegramLink(vipLink);
        } else {
          window.location.href = vipLink;
        }
        setTimeout(() => {
          try {
            tg.close();
          } catch {}
        }, 500);
      } else {
        window.location.href = vipLink;
      }
    }
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6 text-center">
      <div className="w-10 h-10 border-4 border-amber-500/20 border-t-amber-500 rounded-full animate-spin mb-4" />
      <h2 className="text-base font-semibold text-slate-200">የቪአይፒ ቻናሎችን በመክፈት ላይ...</h2>
      <p className="text-xs text-slate-400 mt-1">Opening VIP Channels...</p>
    </div>
  );
}
