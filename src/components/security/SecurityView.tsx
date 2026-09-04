import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { Role, User } from '../../types';
import { Shield, Users, Key, Plus, X, Edit3, Trash2, Lock, Unlock, AlertTriangle, UserCheck, UserX } from 'lucide-react';

const ALL_MODULES = [
  { id: 'dashboard', name: 'Dashboard', hasView: true, hasAdd: false, hasEdit: false, hasDelete: false },
  { id: 'cells', name: 'Cells (Inventory, OCV, Grading)', hasView: true, hasAdd: true, hasEdit: true, hasDelete: true },
  { id: 'modules', name: 'Modules (Assembly, Welding, QC)', hasView: true, hasAdd: true, hasEdit: true, hasDelete: true },
  { id: 'battery_pack', name: 'Battery Pack (Assembly, IR, Final QC)', hasView: true, hasAdd: true, hasEdit: true, hasDelete: true },
  { id: 'bms', name: 'BMS (Acknowledge, Test, Assign)', hasView: true, hasAdd: true, hasEdit: true, hasDelete: true },
  { id: 'bmu', name: 'BMU (Acknowledge, Test, Assign)', hasView: true, hasAdd: true, hasEdit: true, hasDelete: true },
  { id: 'inventory', name: 'Inventory & Stock Management', hasView: true, hasAdd: true, hasEdit: true, hasDelete: true },
  { id: 'production', name: 'Production Orders & 2D Twin', hasView: true, hasAdd: true, hasEdit: true, hasDelete: true },
  { id: 'products', name: 'Product Configurator & Templates', hasView: true, hasAdd: true, hasEdit: true, hasDelete: true },
  { id: 'reports', name: 'Reports & Analytics', hasView: true, hasAdd: false, hasEdit: false, hasDelete: false },
  { id: 'traceability', name: 'Genealogy & Traceability', hasView: true, hasAdd: false, hasEdit: false, hasDelete: false },
  { id: 'security', name: 'Security (Users & Roles)', hasView: true, hasAdd: true, hasEdit: true, hasDelete: true },
];

const CUSTOM_PERMISSION_GROUPS = [
  {
    group: 'PRODUCTION',
    permissions: [
      { id: 'production.start', label: 'Start Production' },
      { id: 'production.pause', label: 'Pause Production' },
      { id: 'production.complete', label: 'Complete Production' },
      { id: 'production.cancel', label: 'Cancel Production' },
      { id: 'production.scan_component', label: 'Scan Component Barcode' },
    ],
  },
  {
    group: 'COMPONENTS',
    permissions: [
      { id: 'assign_cell', label: 'Assign Cell' },
      { id: 'assign_bms', label: 'Assign BMS' },
      { id: 'assign_bmu', label: 'Assign BMU' },
      { id: 'consume', label: 'Consume Component' },
    ],
  },
  {
    group: 'QUALITY',
    permissions: [
      { id: 'qc.perform', label: 'Perform QC' },
      { id: 'qc.approve', label: 'Approve QC' },
      { id: 'qc.reject', label: 'Reject QC' },
      { id: 'inventory.quarantine', label: 'Scrap Component' },
      { id: 'inventory.rework', label: 'Rework Disposition' },
    ],
  },
  {
    group: 'TESTING',
    permissions: [
      { id: 'supplier_value', label: 'Use Supplier Value' },
      { id: 'manual', label: 'Manual Test Entry' },
      { id: 'machine', label: 'Machine Test Override' },
      { id: 'bypass', label: 'Bypass Step' },
    ],
  },
  {
    group: 'RELEASE',
    permissions: [
      { id: 'qc.approve_final', label: 'Approve Final QC' },
      { id: 'battery.release', label: 'Release Battery' },
      { id: 'approve_bypass', label: 'Approve Bypass' },
    ],
  },
  {
    group: 'SECURITY',
    permissions: [
      { id: 'security.users', label: 'Manage Users' },
      { id: 'security.roles', label: 'Manage Roles' },
      { id: 'security.permissions', label: 'Manage Permissions' },
    ],
  },
];

export const SecurityView: React.FC = () => {
  const { currentUser, isAuthenticated } = useAuth();
  const { addNotification } = useApp();

  const currentProfile = currentUser;
  const canManageUsers = currentUser?.roleId === 'role-admin' || currentUser?.role === 'admin';
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'users' | 'roles'>('users');
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);

  const [showUserModal, setShowUserModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [userName, setUserName] = useState('');
  const [userUsername, setUserUsername] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [userRoleId, setUserRoleId] = useState('');
  const [userStatus, setUserStatus] = useState<'ACTIVE' | 'INACTIVE'>('ACTIVE');
  const [userBadgeId, setUserBadgeId] = useState('');
  const [userPassword, setUserPassword] = useState('');

  const [showRoleModal, setShowRoleModal] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [roleName, setRoleName] = useState('');
  const [roleStatus, setRoleStatus] = useState<'ACTIVE' | 'INACTIVE'>('ACTIVE');
  const [rolePerms, setRolePerms] = useState<string[]>([]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [nextUsers, nextRoles] = await Promise.all([api.getUsers(), api.getRoles()]);
      setUsers(nextUsers);
      setRoles(nextRoles);
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'Failed to load security data');
      setUsers([]);
      setRoles([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      loadData();
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (!userRoleId && roles.length > 0) setUserRoleId('role-operator');
  }, [roles, userRoleId]);

  const handleOpenEditUser = (u: User) => {
    setEditingUser(u);
    setUserName(u.name);
    setUserUsername(u.username);
    setUserEmail(u.email || '');
    setUserRoleId(u.roleId);
    setUserStatus(u.status || 'ACTIVE');
    setUserBadgeId(u.badgeId || '');
    setUserPassword('');
    setShowUserModal(true);
  };

  const handleDeleteUser = async (u: User) => {
    if (!window.confirm(`Delete user ${u.username}?`)) return;
    try {
      await api.deleteUser(u.id, currentUser?.id);
      addNotification('success', 'User deleted', `${u.username} was removed.`);
      await loadData();
    } catch (err: any) {
      addNotification('error', 'Delete failed', err?.message || 'Could not delete user');
    }
  };

  const handleToggleUserStatus = async (u: User) => {
    const nextStatus = u.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    try {
      await api.updateUser(u.id, { status: nextStatus }, currentUser?.id);
      await loadData();
    } catch (err: any) {
      addNotification('error', 'Update failed', err?.message || 'Could not update user');
    }
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload: Partial<User> = {
      name: userName,
      username: userUsername,
      email: userEmail,
      roleId: userRoleId,
      status: userStatus,
      badgeId: userBadgeId,
      ...(editingUser ? {} : { password: userPassword }),
    };
    try {
      if (editingUser) {
        await api.updateUser(editingUser.id, payload, currentUser?.id);
      } else {
        await api.createUser(payload, currentUser?.id);
      }
      setShowUserModal(false);
      setEditingUser(null);
      await loadData();
    } catch (err: any) {
      addNotification('error', 'Save failed', err?.message || 'Could not save user');
    }
  };

  const handleOpenEditRole = (r: Role) => {
    setEditingRole(r);
    setRoleName(r.name);
    setRoleStatus(r.status);
    setRolePerms(r.permissions || []);
    setShowRoleModal(true);
  };

  const handleDeleteRole = async (r: Role) => {
    if (!window.confirm(`Delete role ${r.name}?`)) return;
    try {
      await api.deleteRole(r.id, currentUser?.id);
      addNotification('success', 'Role deleted', `${r.name} was removed.`);
      await loadData();
    } catch (err: any) {
      addNotification('error', 'Delete failed', err?.message || 'Could not delete role');
    }
  };

  const handleToggleRoleStatus = async (r: Role) => {
    const nextStatus = r.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    try {
      await api.updateRole(r.id, { status: nextStatus }, currentUser?.id);
      await loadData();
    } catch (err: any) {
      addNotification('error', 'Update failed', err?.message || 'Could not update role');
    }
  };

  const handleTogglePerm = (id: string) => {
    setRolePerms(prev => (prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]));
  };

  const handleToggleAllPerms = () => {
    setRolePerms(prev => (prev.includes('ALL') ? [] : ['ALL']));
  };

  const handleSaveRole = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload: Partial<Role> = {
      name: roleName,
      status: roleStatus,
      permissions: rolePerms,
    };
    try {
      if (editingRole) {
        await api.updateRole(editingRole.id, payload, currentUser?.id);
      } else {
        await api.createRole(payload, currentUser?.id);
      }
      setShowRoleModal(false);
      setEditingRole(null);
      await loadData();
    } catch (err: any) {
      addNotification('error', 'Save failed', err?.message || 'Could not save role');
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto pb-16">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
        <div>
          <div className="flex items-center space-x-2 text-emerald-600 font-bold text-xs uppercase tracking-widest mb-1">
            <Shield className="w-4 h-4" />
            <span>Access Control & Security</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
            Role-Based Access Control (RBAC)
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Manage factory employee accounts, custom roles, and strict module/action permissions.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isAuthenticated && currentProfile ? (
            <div className="flex items-center gap-2">
              {canManageUsers && <button
                onClick={() => {
                  setEditingUser(null);
                  setUserName('');
                  setUserUsername('');
                  setUserEmail('');
                  setUserRoleId('role-operator');
                  setUserStatus('ACTIVE');
                  setUserBadgeId('');
                  setUserPassword('');
                  setShowUserModal(true);
                }}
                className="px-3 py-1.5 bg-emerald-600 text-white text-xs font-bold rounded-lg flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" /> User
              </button>}
              <div className="w-7 h-7 rounded-lg bg-slate-900 text-white flex items-center justify-center font-bold text-xs">
                {currentProfile.name?.charAt(0) || '—'}
              </div>
              <div className="hidden sm:block text-left">
                <p className="text-xs font-bold text-slate-900 leading-tight">{currentProfile.name || '—'}</p>
                <p className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">{String(currentProfile.role || currentProfile.roleId || '—').replace('_', ' ')}</p>
              </div>
            </div>
          ) : (
            <div className="hidden">
              <p className="text-slate-500 text-sm">Please log in to access security features</p>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="p-4 bg-slate-100 border border-slate-300 rounded-xl flex items-center space-x-3 text-xs font-semibold">
          <AlertTriangle className="w-5 h-5 shrink-0 text-slate-700" />
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto text-slate-500 hover:text-black">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-slate-200">
        <button
          onClick={() => setActiveTab('users')}
          className={`px-6 py-3 text-xs font-bold flex items-center space-x-2 border-b-2 transition-colors ${
            activeTab === 'users'
              ? 'border-emerald-600 text-emerald-600 bg-emerald-50/30'
              : 'border-transparent text-slate-500 hover:text-slate-900'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>User Accounts ({users.length})</span>
        </button>
        {canManageUsers && (
          <button
            onClick={() => setActiveTab('roles')}
            className={`px-6 py-3 text-xs font-bold flex items-center space-x-2 border-b-2 transition-colors ${
              activeTab === 'roles'
                ? 'border-emerald-600 text-emerald-600 bg-emerald-50/30'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <Key className="w-4 h-4" />
            <span>Role & Permission Matrix ({roles.length})</span>
          </button>
        )}
      </div>

      {/* USERS TAB */}
      {activeTab === 'users' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
            <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">Registered Factory Personnel</span>
            <span className="text-[11px] text-slate-400 font-mono">Enforced Backend Authorization Active</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-200 text-[11px] font-black uppercase text-slate-500 tracking-wider">
                  <th className="py-3 px-4">User Details</th>
                  <th className="py-3 px-4">Username</th>
                  <th className="py-3 px-4">Assigned Role</th>
                  <th className="py-3 px-4">Badge ID</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs text-slate-700">
                {users.map(u => {
                  const assignedRole = roles.find(r => r.id === u.roleId) || { name: u.role || 'Operator' };
                  return (
                    <tr key={u.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="py-3.5 px-4">
                        <div className="flex items-center space-x-3">
                          <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-700 font-bold flex items-center justify-center text-xs">
                            {u.name.charAt(0)}
                          </div>
                          <div>
                            <span className="font-bold text-slate-900 block">{u.name}</span>
                            <span className="text-[11px] text-slate-400">{u.email || 'No email specified'}</span>
                          </div>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 font-mono text-slate-600 font-semibold">{u.username}</td>
                      <td className="py-3.5 px-4">
                        <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 rounded-lg text-[11px] font-bold border border-emerald-100">
                          {typeof assignedRole === 'object' ? assignedRole.name : assignedRole}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 font-mono text-slate-500">{u.badgeId}</td>
                      <td className="py-3.5 px-4">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                            u.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-100 text-slate-500 border border-slate-200'
                          }`}
                        >
                          {u.status || 'ACTIVE'}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-right space-x-2">
                        {u.id !== 'usr-admin-01' ? (
                          <>
                            <button
                              onClick={() => handleToggleUserStatus(u)}
                              title={u.status === 'ACTIVE' ? 'Deactivate User' : 'Activate User'}
                              className={`p-1.5 rounded-lg border transition-colors ${
                                u.status === 'ACTIVE'
                                  ? 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                                  : 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                              }`}>
                              {u.status === 'ACTIVE' ? <UserX className="w-3.5 h-3.5" /> : <UserCheck className="w-3.5 h-3.5" />}
                            </button>
                            <button
                              onClick={() => handleOpenEditUser(u)}
                              className="p-1.5 bg-slate-50 text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors"
                              title="Edit User"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDeleteUser(u)}
                              className="p-1.5 bg-slate-100 text-slate-900 border border-slate-300 rounded-lg hover:bg-slate-200 transition-colors"
                              title="Delete User"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ROLES TAB */}
      {activeTab === 'roles' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
            <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">Configured Roles & Permission Sets</span>
            <span className="text-[11px] text-slate-400 font-mono">Modules & Custom Actions</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-200 text-[11px] font-black uppercase text-slate-500 tracking-wider">
                  <th className="py-3 px-4">Role Name</th>
                  <th className="py-3 px-4">Description</th>
                  <th className="py-3 px-4">Assigned Users</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Permissions Scope</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs text-slate-700">
                {roles.map(r => {
                  const assignedCount = users.filter(user => user.roleId === r.id).length;
                  const activeCount = users.filter(user => user.roleId === r.id && user.status === 'ACTIVE').length;
                  return (
                    <tr key={r.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="py-3.5 px-4 font-bold text-slate-900">{r.name}</td>
                      <td className="py-3.5 px-4 text-slate-500 max-w-xs truncate">{r.description || 'No description'}</td>
                      <td className="py-3.5 px-4">
                        <span className="font-mono px-2 py-0.5 bg-slate-100 rounded-md text-slate-700 font-bold">
                          {assignedCount} users
                          <span className="ml-1 text-slate-500">({activeCount} active)</span>
                        </span>
                      </td>
                      <td className="py-3.5 px-4">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                            r.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-100 text-slate-500 border border-slate-200'
                          }`}
                        >
                          {r.status}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 font-mono text-[11px] text-emerald-600 font-semibold">
                        {r.permissions.includes('ALL') ? 'ALL PERMISSIONS' : `${r.permissions.length} specific permissions`}
                      </td>
                      <td className="py-3.5 px-4 text-right space-x-2">
                        {r.id !== 'role-admin' ? (
                          <>
                            <button
                              onClick={() => handleToggleRoleStatus(r)}
                              title={r.status === 'ACTIVE' ? 'Deactivate Role' : 'Activate Role'}
                              className={`p-1.5 rounded-lg border transition-colors ${
                                r.status === 'ACTIVE'
                                  ? 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                                  : 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                              }`}>
                                {r.status === 'ACTIVE' ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                              </button>
                            <button
                              onClick={() => handleOpenEditRole(r)}
                              className="p-1.5 bg-slate-50 text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors"
                              title="Edit Role & Permissions"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDeleteRole(r)}
                              className="p-1.5 bg-slate-100 text-slate-900 border border-slate-300 rounded-lg hover:bg-slate-200 transition-colors"
                              title="Delete Role"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* CREATE / EDIT USER MODAL */}
      {showUserModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full border border-slate-200 shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wide">
                {editingUser ? 'Edit User Account' : 'Create Factory User'}
              </h3>
              <button onClick={() => setShowUserModal(false)} className="text-slate-400 hover:text-slate-700">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveUser} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Full Name *</label>
                <input
                  type="text"
                  required
                  value={userName}
                  onChange={e => setUserName(e.target.value)}
                  placeholder="e.g. Marco Rossi"
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Username (Login ID) *</label>
                <input
                  type="text"
                  required
                  value={userUsername}
                  onChange={e => setUserUsername(e.target.value)}
                  placeholder="e.g. mrossi"
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Email Address</label>
                <input
                  type="email"
                  required
                  value={userEmail}
                  onChange={e => setUserEmail(e.target.value)}
                  placeholder="marco.r@power2go.com"
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Assigned Role *</label>
                  <select
                    value={userRoleId}
                    onChange={e => setUserRoleId(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    {roles.map(r => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Account Status</label>
                  <select
                    value={userStatus}
                    onChange={e => setUserStatus(e.target.value as any)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="ACTIVE">ACTIVE</option>
                    <option value="INACTIVE">INACTIVE</option>
                  </select>
                </div>
              </div>

              {!editingUser && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Initial Password *</label>
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={userPassword}
                    onChange={e => setUserPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              )}

              <div className="block text-xs font-bold text-slate-700 mb-1">Hardware Badge ID</div>
              <input
                type="text"
                value={userBadgeId}
                onChange={e => setUserBadgeId(e.target.value)}
                placeholder="P2G-OPR-109"
                className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />

              <div className="flex justify-end space-x-2 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowUserModal(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xs shadow-xs transition-colors"
                >
                  {editingUser ? 'Save Changes' : 'Create User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CREATE / EDIT ROLE MODAL WITH PERMISSION MATRIX */}
      {showRoleModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-4xl w-full max-h-[90vh] flex flex-col border border-slate-200 shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div>
                <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wide">
                  {editingRole ? `Edit Role: ${editingRole.name}` : 'Create Custom Factory Role'}
                </h3>
                <p className="text-[11px] text-slate-500">Configure standard CRUD permissions and custom manufacturing action overrides.</p>
              </div>
              <button onClick={() => setShowRoleModal(false)} className="text-slate-400 hover:text-slate-700">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveRole} className="flex-1 overflow-y-auto p-6 space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Role Name *</label>
                  <input
                    type="text"
                    required
                    value={roleName}
                    onChange={e => setRoleName(e.target.value)}
                    placeholder="e.g. Production Operator"
                    className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Status</label>
                  <select
                    value={roleStatus}
                    onChange={e => setRoleStatus(e.target.value as any)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="ACTIVE">ACTIVE</option>
                    <option value="INACTIVE">INACTIVE</option>
                  </select>
                </div>
              </div>

              {/* Administrator All Permissions Toggle */}
              <div className="p-4 bg-emerald-50/60 rounded-xl border border-emerald-100 flex items-center justify-between">
                <div>
                  <span className="font-bold text-emerald-900 text-xs block">Grant Full Administrator Access</span>
                  <span className="text-[11px] text-emerald-600">Bypasses all granular permission checks (ALL PERMISSIONS)</span>
                </div>
                <input
                  type="checkbox"
                  checked={rolePerms.includes('ALL')}
                  onChange={handleToggleAllPerms}
                  className="w-4 h-4 text-emerald-600 rounded focus:ring-emerald-500 border-slate-300"
                />
              </div>

              {!rolePerms.includes('ALL') && (
                <div className="space-y-6">
                  {/* MODULE PERMISSION MATRIX */}
                  <div>
                    <h4 className="text-xs font-black text-slate-900 uppercase tracking-wider mb-3">Module Permission Matrix</h4>
                    <div className="bg-slate-50 rounded-xl border border-slate-200 overflow-hidden">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="bg-slate-100 border-b border-slate-200 text-[10px] font-black uppercase text-slate-500 tracking-wider">
                            <th className="py-2.5 px-3">Module Name</th>
                            <th className="py-2.5 px-3 text-center">View</th>
                            <th className="py-2.5 px-3 text-center">Add</th>
                            <th className="py-2.5 px-3 text-center">Edit</th>
                            <th className="py-2.5 px-3 text-center">Delete</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                          {ALL_MODULES.map(m => {
                            const viewId = `${m.id}.view`;
                            const addId = `${m.id}.add`;
                            const editId = `${m.id}.edit`;
                            const deleteId = `${m.id}.delete`;

                            return (
                              <tr key={m.id} className="hover:bg-white transition-colors">
                                <td className="py-2 px-3 font-semibold text-slate-800">{m.name}</td>
                                <td className="py-2 px-3 text-center">
                                  {m.hasView && (
                                    <input
                                      type="checkbox"
                                      checked={rolePerms.includes(viewId)}
                                      onChange={() => handleTogglePerm(viewId)}
                                      className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500"
                                    />
                                  )}
                                </td>
                                <td className="py-2 px-3 text-center">
                                  {m.hasAdd && (
                                    <input
                                      type="checkbox"
                                      checked={rolePerms.includes(addId)}
                                      onChange={() => handleTogglePerm(addId)}
                                      className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500"
                                    />
                                  )}
                                </td>
                                <td className="py-2 px-3 text-center">
                                  {m.hasEdit && (
                                    <input
                                      type="checkbox"
                                      checked={rolePerms.includes(editId)}
                                      onChange={() => handleTogglePerm(editId)}
                                      className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500"
                                    />
                                  )}
                                </td>
                                <td className="py-2 px-3 text-center">
                                  {m.hasDelete && (
                                    <input
                                      type="checkbox"
                                      checked={rolePerms.includes(deleteId)}
                                      onChange={() => handleTogglePerm(deleteId)}
                                      className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500"
                                    />
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* CUSTOM MANUFACTURING PERMISSIONS */}
                  <div>
                    <h4 className="text-xs font-black text-slate-900 uppercase tracking-wider mb-3">Custom Manufacturing & Quality Actions</h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {CUSTOM_PERMISSION_GROUPS.map(g => (
                        <div key={g.group} className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-2">
                          <span className="text-[10px] font-black uppercase text-emerald-600 tracking-wider border-b border-slate-200 pb-1">
                            {g.group}
                          </span>
                          <div className="space-y-1.5">
                            {g.permissions.map(p => (
                              <label key={p.id} className="flex items-center space-x-2.5 text-xs text-slate-700 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={rolePerms.includes(p.id)}
                                  onChange={() => handleTogglePerm(p.id)}
                                  className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500"
                                />
                                <span>{p.label}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <div className="flex justify-end space-x-2 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowRoleModal(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl shadow-xs transition-colors"
                >
                  {editingRole ? 'Save Role' : 'Create Role'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};