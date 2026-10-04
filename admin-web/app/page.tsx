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

  const filteredPayments = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return payments.filter(p =>
      (p.transaction_id || '').toLowerCase().includes(q) ||
      (p.payer_name || '').toLowerCase().includes(q) ||
      (p.phone || '').toLowerCase().includes(q) ||
      (p.bank || '').toLowerCase().includes(q)
    );
  }, [payments, searchQuery]);

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
            </div>
            <p className="text-sm text-slate-400 mt-1">
              Live Telegram Bot Management, Payment Verifications & Channel Memberships
            </p>
          </div>
          <button
            onClick={fetchData}
            className="self-start md:self-auto px-4 py-2 text-xs font-medium rounded-lg bg-slate-900 hover:bg-slate-800 transition border border-slate-800 text-slate-200"
          >
            ↻ Refresh Data
          </button>
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
                    <th className="py-3.5 px-4">Date</th>
                    <th className="py-3.5 px-4">TID</th>
                    <th className="py-3.5 px-4">Payer</th>
                    <th className="py-3.5 px-4">Phone</th>
                    <th className="py-3.5 px-4">Amount</th>
                    <th className="py-3.5 px-4">Bank</th>
                    <th className="py-3.5 px-4">Status</th>
                    <th className="py-3.5 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {filteredPayments.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-slate-500">
                        No payments found.
                      </td>
                    </tr>
                  ) : (
                    filteredPayments.map((p) => (
                      <tr key={p.id} className="hover:bg-slate-800/30 transition">
                        <td className="py-3.5 px-4 text-slate-400 whitespace-nowrap">
                          {p.created_at ? new Date(p.created_at).toLocaleDateString() : 'N/A'}
                        </td>
                        <td className="py-3.5 px-4 font-mono font-medium text-amber-300">
                          {p.transaction_id}
                        </td>
                        <td className="py-3.5 px-4 font-medium text-slate-200">
                          {p.payer_name || 'N/A'}
                        </td>
                        <td className="py-3.5 px-4 text-slate-400 font-mono">
                          {p.phone || 'N/A'}
                        </td>
                        <td className="py-3.5 px-4 font-bold text-emerald-400">
                          {p.amount} ETB
                        </td>
                        <td className="py-3.5 px-4 text-slate-300">
                          <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-xs">
                            {p.bank || 'Bank'}
                          </span>
                        </td>
                        <td className="py-3.5 px-4">
                          <span
                            className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                              p.status === 'approved'
                                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                : p.status === 'rejected'
                                ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                                : 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20'
                            }`}
                          >
                            {p.status || 'approved'}
                          </span>
                        </td>
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
                    ))
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs sm:text-sm">
                <thead className="bg-slate-900/90 text-slate-400 uppercase tracking-wider text-xs border-b border-slate-800">
                  <tr>
                    <th className="py-3.5 px-4">User ID</th>
                    <th className="py-3.5 px-4">Full Name</th>
                    <th className="py-3.5 px-4">Username</th>
                    <th className="py-3.5 px-4">Phone</th>
                    <th className="py-3.5 px-4">Status</th>
                    <th className="py-3.5 px-4">Expires</th>
                    <th className="py-3.5 px-4 text-right">VIP Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {filteredUsers.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-slate-500">
                        No users found.
                      </td>
                    </tr>
                  ) : (
                    filteredUsers.map((u) => (
                      <tr key={u.user_id} className="hover:bg-slate-800/30 transition">
                        <td className="py-3.5 px-4 font-mono text-slate-400">
                          {u.user_id}
                        </td>
                        <td className="py-3.5 px-4 font-medium text-slate-200">
                          {u.full_name || 'Anonymous'}
                        </td>
                        <td className="py-3.5 px-4 text-amber-400 font-mono">
                          {u.username ? `@${u.username}` : '-'}
                        </td>
                        <td className="py-3.5 px-4 text-slate-400 font-mono">
                          {u.phone || 'Not shared'}
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
                        <td className="py-3.5 px-4 text-slate-400 whitespace-nowrap">
                          {u.expiry_date || '-'}
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
                    ))
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
