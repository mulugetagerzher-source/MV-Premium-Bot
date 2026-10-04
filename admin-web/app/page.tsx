'use client';

export const dynamic = 'force-dynamic';

import React, { useEffect, useState, useMemo } from 'react';
import { supabase } from '../lib/supabase';

interface User {
  user_id: number;
  username?: string;
  full_name?: string;
  phone?: string;
  start_date?: string;
  expiry_date?: string;
  is_vip: number;
}

interface Payment {
  id: number;
  user_id: number;
  payer_name: string;
  phone: string;
  transaction_id: string;
  amount: number;
  bank?: string;
  status: 'approved' | 'pending' | 'rejected';
  created_at: string;
}

export default function AdminDashboardPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'payments' | 'users'>('payments');
  const [searchQuery, setSearchQuery] = useState('');
  const [actionLoadingId, setActionLoadingId] = useState<string | number | null>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [usersRes, paymentsRes] = await Promise.all([
        supabase.from('users').select('*').order('user_id', { ascending: false }),
        supabase.from('payments').select('*').order('created_at', { ascending: false })
      ]);

      if (usersRes.data) setUsers(usersRes.data as User[]);
      if (paymentsRes.data) setPayments(paymentsRes.data as Payment[]);
    } catch (err) {
      console.error('Error fetching data from Supabase:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();

    // Realtime Postgres Sync
    const channel = supabase
      .channel('schema-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, () => {
        fetchData();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, () => {
        fetchData();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const stats = useMemo(() => {
    const totalRevenue = payments.reduce((acc, p) => acc + (Number(p.amount) || 0), 0);
    const activeVips = users.filter(u => u.is_vip === 1).length;
    
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const expiringSoon = users.filter(u => {
      if (!u.expiry_date || u.is_vip !== 1) return false;
      const exp = new Date(u.expiry_date);
      return exp > now && exp <= tomorrow;
    }).length;

    return {
      totalRevenue,
      activeVips,
      expiringSoon,
      totalUsers: users.length,
    };
  }, [payments, users]);

  const handleToggleVip = async (user: User) => {
    setActionLoadingId(user.user_id);
    const newStatus = user.is_vip === 1 ? 0 : 1;
    const nowStr = new Date().toISOString();
    const expiryStr = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    const payload = newStatus === 1
      ? { is_vip: 1, start_date: nowStr, expiry_date: expiryStr }
      : { is_vip: 0 };

    await supabase.from('users').update(payload).eq('user_id', user.user_id);
    await fetchData();
    setActionLoadingId(null);
  };

  const handleUpdatePaymentStatus = async (paymentId: number, status: 'approved' | 'rejected') => {
    setActionLoadingId(paymentId);
    await supabase.from('payments').update({ status }).eq('id', paymentId);
    await fetchData();
    setActionLoadingId(null);
  };

  const userMap = useMemo(() => {
    const map = new Map<number, User>();
    for (const u of users) {
      map.set(u.user_id, u);
    }
    return map;
  }, [users]);

  const formatDate = (val?: string | null) => {
    if (!val) return '-';
    try {
      const d = new Date(val);
      if (isNaN(d.getTime())) return val;
      return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch {
      return val;
    }
  };

  const filteredPayments = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return payments.filter(p => {
      const u = userMap.get(p.user_id);
      return (
        (p.transaction_id || '').toLowerCase().includes(q) ||
        (p.payer_name || '').toLowerCase().includes(q) ||
        (p.phone || '').toLowerCase().includes(q) ||
        (p.bank || '').toLowerCase().includes(q) ||
        String(p.user_id).includes(q) ||
        (u?.full_name || '').toLowerCase().includes(q) ||
        (u?.username || '').toLowerCase().includes(q) ||
        (u?.phone || '').toLowerCase().includes(q)
      );
    });
  }, [payments, userMap, searchQuery]);

  const filteredUsers = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return users.filter(u =>
      (u.full_name || '').toLowerCase().includes(q) ||
      (u.username || '').toLowerCase().includes(q) ||
      (u.phone || '').toLowerCase().includes(q) ||
      String(u.user_id).includes(q)
    );
  }, [users, searchQuery]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6 md:p-10 font-sans">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Top Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-6">
          <div>
            <div className="flex items-center gap-3">
              <span className="text-2xl font-black bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-500 bg-clip-text text-transparent">
                WONDE VIP ADMIN
              </span>
              <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                Supabase Realtime
              </span>
              <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-sky-500/10 text-sky-400 border border-sky-500/20">
                Vercel Serverless Bot
              </span>
            </div>
            <p className="text-sm text-slate-400 mt-1">
              Live Telegram Bot Management, Payment Verifications & Channel Memberships
            </p>
          </div>
          <div className="flex items-center gap-2 self-start md:self-auto">
            <button
              onClick={async () => {
                try {
                  const res = await fetch('/api/telegram/setup');
                  const json = await res.json();
                  if (json.ok) {
                    alert(`✅ Telegram Webhook Connected!\n\nBot: @${json.bot}\nWebhook: ${json.webhookUrl}`);
                  } else {
                    alert(`⚠️ Webhook setup issue: ${json.error || JSON.stringify(json)}`);
                  }
                } catch (e: any) {
                  alert(`Error connecting webhook: ${e.message}`);
                }
              }}
              className="px-3.5 py-2 text-xs font-medium rounded-lg bg-sky-600/20 hover:bg-sky-600/30 transition border border-sky-500/30 text-sky-300"
            >
              ⚡ Sync Telegram Webhook
            </button>
            <button
              onClick={fetchData}
              className="px-4 py-2 text-xs font-medium rounded-lg bg-slate-900 hover:bg-slate-800 transition border border-slate-800 text-slate-200"
            >
              ↻ Refresh
            </button>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800/80 shadow-lg">
            <span className="text-xs uppercase tracking-wider text-slate-400 font-semibold">Total Revenue</span>
            <div className="text-2xl font-bold mt-2 text-emerald-400">
              {stats.totalRevenue.toLocaleString()} <span className="text-xs font-normal text-slate-400">ETB</span>
            </div>
            <span className="text-xs text-slate-500 mt-1 block">From verified bank payments</span>
          </div>

          <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800/80 shadow-lg">
            <span className="text-xs uppercase tracking-wider text-slate-400 font-semibold">Active VIPs</span>
            <div className="text-2xl font-bold mt-2 text-amber-400">
              {stats.activeVips} <span className="text-xs font-normal text-slate-400">Members</span>
            </div>
            <span className="text-xs text-slate-500 mt-1 block">Active in 49 channels</span>
          </div>

          <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800/80 shadow-lg">
            <span className="text-xs uppercase tracking-wider text-slate-400 font-semibold">Expiring in 24h</span>
            <div className="text-2xl font-bold mt-2 text-rose-400">
              {stats.expiringSoon} <span className="text-xs font-normal text-slate-400">Users</span>
            </div>
            <span className="text-xs text-slate-500 mt-1 block">Scheduled for auto-ban</span>
          </div>

          <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800/80 shadow-lg">
            <span className="text-xs uppercase tracking-wider text-slate-400 font-semibold">Total Registered</span>
            <div className="text-2xl font-bold mt-2 text-sky-400">
              {stats.totalUsers}
            </div>
            <span className="text-xs text-slate-500 mt-1 block">All registered bot users</span>
          </div>
        </div>

        {/* Tab Controls & Search */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-4">
          <div className="flex bg-slate-900 p-1 rounded-xl border border-slate-800 self-start">
            <button
              onClick={() => setActiveTab('payments')}
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition ${
                activeTab === 'payments'
                  ? 'bg-amber-500 text-slate-950 shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              💳 Transactions ({payments.length})
            </button>
            <button
              onClick={() => setActiveTab('users')}
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition ${
                activeTab === 'users'
                  ? 'bg-amber-500 text-slate-950 shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              👥 VIP Subscribers ({users.length})
            </button>
          </div>

          <input
            type="text"
            placeholder={`Search ${activeTab === 'payments' ? 'TID, phone, name...' : 'Name, phone, username...'}`}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full sm:w-72 px-4 py-2 rounded-xl bg-slate-900 border border-slate-800 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500/50"
          />
        </div>

        {/* Tables */}
        <div className="rounded-2xl bg-slate-900/60 border border-slate-800 overflow-hidden shadow-2xl">
          {loading ? (
            <div className="p-12 text-center text-slate-500 text-sm animate-pulse">
              Syncing with Supabase Cloud...
            </div>
          ) : activeTab === 'payments' ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs sm:text-sm">
                <thead className="bg-slate-900/90 text-slate-400 uppercase tracking-wider text-xs border-b border-slate-800">
                  <tr>
                    <th className="py-3.5 px-3 text-center">NO.</th>
                    <th className="py-3.5 px-4">Telegram name</th>
                    <th className="py-3.5 px-4">Username</th>
                    <th className="py-3.5 px-4">Phone Number</th>
                    <th className="py-3.5 px-4">User_ID</th>
                    <th className="py-3.5 px-4">Payer name</th>
                    <th className="py-3.5 px-4">Transaction ID</th>
                    <th className="py-3.5 px-4">Payment Method</th>
                    <th className="py-3.5 px-4">Amount</th>
                    <th className="py-3.5 px-4">S/Date</th>
                    <th className="py-3.5 px-4">E/Date</th>
                    <th className="py-3.5 px-4">Exp</th>
                    <th className="py-3.5 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {filteredPayments.length === 0 ? (
                    <tr>
                      <td colSpan={13} className="py-8 text-center text-slate-500">
                        No payments found.
                      </td>
                    </tr>
                  ) : (
                    filteredPayments.map((p, idx) => {
                      const u = userMap.get(p.user_id);
                      const phone = (u?.phone && u.phone !== 'None' && u.phone !== 'Not shared')
                        ? u.phone
                        : (p.phone && p.phone !== 'None' ? p.phone : '-');
                      const sDate = formatDate(u?.start_date || p.created_at);
                      const eDate = formatDate(u?.expiry_date);

                      let expBadge: React.ReactNode = '-';
                      if (u?.expiry_date) {
                        const expTime = new Date(u.expiry_date).getTime();
                        const nowTime = Date.now();
                        const daysLeft = Math.ceil((expTime - nowTime) / (1000 * 60 * 60 * 24));
                        if (daysLeft > 0) {
                          expBadge = (
                            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 whitespace-nowrap">
                              {daysLeft}d left
                            </span>
                          );
                        } else {
                          expBadge = (
                            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20 whitespace-nowrap">
                              Expired
                            </span>
                          );
                        }
                      } else if (p.status === 'approved') {
                        expBadge = (
                          <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 whitespace-nowrap">
                            Active
                          </span>
                        );
                      } else if (p.status === 'rejected') {
                        expBadge = (
                          <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20 whitespace-nowrap">
                            Rejected
                          </span>
                        );
                      } else {
                        expBadge = (
                          <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 whitespace-nowrap">
                            Pending
                          </span>
                        );
                      }

                      return (
                        <tr key={p.id} className="hover:bg-slate-800/30 transition">
                          {/* 1. NO. */}
                          <td className="py-3.5 px-3 text-center font-mono text-slate-500 font-semibold">
                            {idx + 1}
                          </td>
                          {/* 2. Telegram name */}
                          <td className="py-3.5 px-4 font-medium text-slate-200 whitespace-nowrap">
                            {u?.full_name || 'Anonymous'}
                          </td>
                          {/* 3. Username */}
                          <td className="py-3.5 px-4 text-amber-400 font-mono whitespace-nowrap">
                            {u?.username && u.username !== 'No_username' ? `@${u.username}` : '-'}
                          </td>
                          {/* 4. Phone Number */}
                          <td className="py-3.5 px-4 text-slate-300 font-mono whitespace-nowrap">
                            {phone}
                          </td>
                          {/* 5. User_ID */}
                          <td className="py-3.5 px-4 font-mono text-slate-400 whitespace-nowrap">
                            {p.user_id}
                          </td>
                          {/* 6. Payer name */}
                          <td className="py-3.5 px-4 font-medium text-slate-200 whitespace-nowrap">
                            {p.payer_name || 'N/A'}
                          </td>
                          {/* 7. Transaction ID */}
                          <td className="py-3.5 px-4 font-mono font-medium text-amber-300 whitespace-nowrap">
                            {p.transaction_id}
                          </td>
                          {/* 8. Payment Method */}
                          <td className="py-3.5 px-4 text-slate-300 whitespace-nowrap">
                            <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-xs font-semibold">
                              {p.bank || 'Bank'}
                            </span>
                          </td>
                          {/* 9. Amount */}
                          <td className="py-3.5 px-4 font-bold text-emerald-400 whitespace-nowrap">
                            {p.amount} ETB
                          </td>
                          {/* 10. S/Date */}
                          <td className="py-3.5 px-4 text-slate-400 whitespace-nowrap font-mono text-xs">
                            {sDate}
                          </td>
                          {/* 11. E/Date */}
                          <td className="py-3.5 px-4 text-slate-400 whitespace-nowrap font-mono text-xs">
                            {eDate}
                          </td>
                          {/* 12. Exp */}
                          <td className="py-3.5 px-4 whitespace-nowrap">
                            {expBadge}
                          </td>
                          {/* Actions */}
                          <td className="py-3.5 px-4 text-right whitespace-nowrap">
                            {p.status !== 'approved' && (
                              <button
                                disabled={actionLoadingId === p.id}
                                onClick={() => handleUpdatePaymentStatus(p.id, 'approved')}
                                className="px-2.5 py-1 text-xs rounded bg-emerald-600 hover:bg-emerald-500 font-semibold text-white mr-2 transition disabled:opacity-50"
                              >
                                Approve
                              </button>
                            )}
                            {p.status !== 'rejected' && (
                              <button
                                disabled={actionLoadingId === p.id}
                                onClick={() => handleUpdatePaymentStatus(p.id, 'rejected')}
                                className="px-2.5 py-1 text-xs rounded bg-rose-900/60 hover:bg-rose-800 text-rose-200 transition disabled:opacity-50"
                              >
                                Reject
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs sm:text-sm">
                <thead className="bg-slate-900/90 text-slate-400 uppercase tracking-wider text-xs border-b border-slate-800">
                  <tr>
                    <th className="py-3.5 px-3 text-center">NO.</th>
                    <th className="py-3.5 px-4">Telegram name</th>
                    <th className="py-3.5 px-4">Username</th>
                    <th className="py-3.5 px-4">Phone Number</th>
                    <th className="py-3.5 px-4">User_ID</th>
                    <th className="py-3.5 px-4">Status</th>
                    <th className="py-3.5 px-4">S/Date</th>
                    <th className="py-3.5 px-4">E/Date</th>
                    <th className="py-3.5 px-4">Exp</th>
                    <th className="py-3.5 px-4 text-right">VIP Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {filteredUsers.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="py-8 text-center text-slate-500">
                        No users found.
                      </td>
                    </tr>
                  ) : (
                    filteredUsers.map((u, idx) => {
                      const sDate = formatDate(u.start_date);
                      const eDate = formatDate(u.expiry_date);

                      let expBadge: React.ReactNode = '-';
                      if (u.expiry_date) {
                        const expTime = new Date(u.expiry_date).getTime();
                        const nowTime = Date.now();
                        const daysLeft = Math.ceil((expTime - nowTime) / (1000 * 60 * 60 * 24));
                        if (daysLeft > 0) {
                          expBadge = (
                            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 whitespace-nowrap">
                              {daysLeft}d left
                            </span>
                          );
                        } else {
                          expBadge = (
                            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20 whitespace-nowrap">
                              Expired
                            </span>
                          );
                        }
                      } else if (u.is_vip === 1) {
                        expBadge = (
                          <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 whitespace-nowrap">
                            ⭐ VIP
                          </span>
                        );
                      } else {
                        expBadge = (
                          <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-800 text-slate-400 border border-slate-700 whitespace-nowrap">
                            Regular
                          </span>
                        );
                      }

                      return (
                        <tr key={u.user_id} className="hover:bg-slate-800/30 transition">
                          <td className="py-3.5 px-3 text-center font-mono text-slate-500 font-semibold">
                            {idx + 1}
                          </td>
                          <td className="py-3.5 px-4 font-medium text-slate-200 whitespace-nowrap">
                            {u.full_name || 'Anonymous'}
                          </td>
                          <td className="py-3.5 px-4 text-amber-400 font-mono whitespace-nowrap">
                            {u.username && u.username !== 'No_username' ? `@${u.username}` : '-'}
                          </td>
                          <td className="py-3.5 px-4 text-slate-300 font-mono whitespace-nowrap">
                            {u.phone && u.phone !== 'None' ? u.phone : 'Not shared'}
                          </td>
                          <td className="py-3.5 px-4 font-mono text-slate-400 whitespace-nowrap">
                            {u.user_id}
                          </td>
                          <td className="py-3.5 px-4">
                            <span
                              className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                                u.is_vip === 1
                                  ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                  : 'bg-slate-800 text-slate-400'
                              }`}
                            >
                              {u.is_vip === 1 ? '⭐ VIP Active' : 'Regular'}
                            </span>
                          </td>
                          <td className="py-3.5 px-4 text-slate-400 whitespace-nowrap font-mono text-xs">
                            {sDate}
                          </td>
                          <td className="py-3.5 px-4 text-slate-400 whitespace-nowrap font-mono text-xs">
                            {eDate}
                          </td>
                          <td className="py-3.5 px-4 whitespace-nowrap">
                            {expBadge}
                          </td>
                          <td className="py-3.5 px-4 text-right whitespace-nowrap">
                            <button
                              disabled={actionLoadingId === u.user_id}
                              onClick={() => handleToggleVip(u)}
                              className={`px-3 py-1 text-xs rounded font-medium transition disabled:opacity-50 ${
                                u.is_vip === 1
                                  ? 'bg-rose-950 text-rose-300 border border-rose-800 hover:bg-rose-900'
                                  : 'bg-amber-500 text-slate-950 font-bold hover:bg-amber-400'
                              }`}
                            >
                              {u.is_vip === 1 ? 'Revoke VIP' : '+ Give 30 Days'}
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
