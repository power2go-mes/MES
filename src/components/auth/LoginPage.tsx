import React, { useState, useRef, useEffect } from 'react';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Layers,
  Lock,
  ShieldCheck,
  User,
  Zap,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useApp } from '../../context/AppContext';
import { Logo } from '../common/Logo';

const LoginPage: React.FC = () => {
  const { setActiveView } = useApp();
  const {
    login,
    verifyOtp,
    resendOtp,
    isAuthenticated,
    isLoading,
    currentUser,
    pendingToken,
  } = useAuth();

  const [identifier, setIdentifier] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [otpValues, setOtpValues] = useState<string[]>(['', '', '', '', '', '']);
  const [verifyingOtp, setVerifyingOtp] = useState<boolean>(false);
  const [resendCooldown, setResendCooldown] = useState<number | null>(null);
  const otpInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (resendCooldown !== null && resendCooldown > 0) {
      const timer = setTimeout(() => setResendCooldown(resendCooldown - 1), 1000);
      return () => clearTimeout(timer);
    }
    if (resendCooldown === 0) setResendCooldown(null);
  }, [resendCooldown]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>, idx?: number) => {
    const value = e.target.value;
    if (idx !== undefined) {
      const digit = value.replace(/\D/g, '').slice(-1);
      setOtpValues(prev => {
        const next = [...prev];
        next[idx] = digit;
        return next;
      });
      if (digit && otpInputRefs.current[idx + 1]) {
        otpInputRefs.current[idx + 1]?.focus();
      }
    } else if (e.target.name === 'identifier') {
      setIdentifier(value);
    } else if (e.target.name === 'password') {
      setPassword(value);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const { success, error: loginError, pendingToken: token } = await login(identifier, password);

    if (!success) {
      setError(loginError || 'Invalid username or password.');
      return;
    }

    if (token) {
      setVerifyingOtp(true);
      setOtpValues(['', '', '', '', '', '']);
      return;
    }

    setActiveView('ceo-monitoring');
  };

  const handleOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const values = otpValues.join('');
    if (values.length !== 6) {
      setError('Please enter all 6 digits');
      return;
    }
    setError('');

    const { success, error: verifyError } = await verifyOtp(pendingToken || '', values);
    if (!success) {
      setError(verifyError || 'Invalid verification code');
      return;
    }

    setActiveView('ceo-monitoring');
  };

  const handleResend = async () => {
    if (resendCooldown !== null) return;
    const result = await resendOtp(pendingToken || '');
    if (result.error) {
      setError(result.error);
      return;
    }
    if (result.resendInSec) {
      setResendCooldown(result.resendInSec);
    }
  };

  useEffect(() => {
    if (isAuthenticated && currentUser) {
      setVerifyingOtp(false);
    }
  }, [isAuthenticated, currentUser]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4 sm:p-6 lg:p-8 relative overflow-hidden">
      {/* Subtle architectural background accent */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-28 -right-24 h-96 w-96 rounded-full bg-emerald-50 border border-emerald-200/60 opacity-60 animate-login-float" />
        <div className="absolute -bottom-32 -left-24 h-80 w-80 rounded-full bg-slate-100 border border-slate-200/80 opacity-80" />
      </div>

      <div className="relative z-10 w-full max-w-4xl rounded-3xl border border-slate-200 bg-white shadow-xl overflow-hidden grid grid-cols-1 md:grid-cols-12 animate-card-enter">
        {/* Left Studio Brand Panel */}
        <div className="md:col-span-5 bg-slate-900 text-white p-7 sm:p-9 flex flex-col justify-between relative overflow-hidden">
          <div className="dashboard-grid absolute inset-0 opacity-20" />
          <div className="relative space-y-6">
            <div className="inline-flex items-center rounded-2xl bg-white px-4 py-2.5 shadow-sm">
              <Logo size="md" />
            </div>

            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/40 bg-emerald-50/10 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-emerald-400">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
              Production System Online
            </div>

            <div>
              <h1 className="text-2xl font-black tracking-tight text-white">
                MES-POWER2GO
              </h1>
              <p className="mt-2 text-xs leading-5 text-slate-300">
                End-to-end lithium battery manufacturing execution, live cell grading, and serialized rack traceability.
              </p>
            </div>

            <div className="space-y-2.5 pt-2 stagger-children">
              {[
                { icon: Layers, title: '2D Module & Pack Builders', desc: 'Visual slot validation & OCV/IR QC' },
                { icon: Zap, title: 'Dynamic LV / HV Racks', desc: 'Flexible rack & cabinet shell assembly' },
                { icon: ShieldCheck, title: 'Full QR Traceability', desc: 'Warehouse, issued custody & audit trail' },
              ].map(({ icon: Icon, title, desc }) => (
                <div
                  key={title}
                  className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5"
                >
                  <Icon className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-bold text-white">{title}</p>
                    <p className="text-[11px] text-slate-400">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="relative pt-6 mt-6 border-t border-white/10 flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-slate-400">
            <span>Factory Control Suite</span>
            <span className="text-emerald-400">v2.1</span>
          </div>
        </div>

        {/* Right Interactive Auth Panel */}
        <div className="md:col-span-7 p-7 sm:p-10 flex flex-col justify-center bg-white">
          <div className="mb-7">
            <div className="inline-flex items-center gap-2 rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-1.5 text-[11px] font-black uppercase tracking-wider text-emerald-700 mb-3">
              {verifyingOtp ? (
                <>
                  <KeyRound className="w-3.5 h-3.5" />
                  Two-Factor Verification
                </>
              ) : (
                <>
                  <Lock className="w-3.5 h-3.5" />
                  Operator &amp; Admin Sign In
                </>
              )}
            </div>
            <h2 className="text-2xl font-black text-slate-900 tracking-tight">
              {verifyingOtp ? 'Enter Verification Code' : 'Welcome back'}
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              {verifyingOtp
                ? 'A 6-digit security code was sent to your registered email.'
                : 'Sign in with your factory credentials to access the production line.'}
            </p>
          </div>

          {error && (
            <div className="mb-5 flex items-center gap-2.5 rounded-xl bg-red-950 text-white px-4 py-3 text-xs font-semibold animate-slide-up shadow-xs">
              <AlertCircle className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {!verifyingOtp ? (
            <form className="space-y-4 animate-tab-enter" onSubmit={handleLogin}>
              <div>
                <label className="block text-[11px] font-black uppercase tracking-wider text-slate-500 mb-1.5">
                  Username or Email
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    name="identifier"
                    value={identifier}
                    onChange={e => handleInputChange(e)}
                    placeholder="operator@power2go.com"
                    required
                    autoComplete="username"
                    className={`w-full rounded-xl border border-slate-200 pl-10 pr-4 py-3 text-sm font-medium text-slate-900 transition-all focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 ${
                      error ? 'border-red-400' : 'bg-slate-50 focus:bg-white'
                    }`}
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-black uppercase tracking-wider text-slate-500 mb-1.5">
                  Password
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    name="password"
                    value={password}
                    onChange={e => handleInputChange(e)}
                    required
                    autoComplete="current-password"
                    placeholder="••••••••"
                    className={`w-full rounded-xl border border-slate-200 pl-10 pr-12 py-3 text-sm font-medium text-slate-900 transition-all focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 ${
                      error ? 'border-red-400' : 'bg-slate-50 focus:bg-white'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className={`mt-2 w-full inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3.5 text-xs font-black uppercase tracking-wider transition-all shadow-xs ${
                  isLoading
                    ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                    : 'bg-emerald-600 text-white hover:bg-emerald-700 active:scale-[0.99]'
                }`}
              >
                {isLoading ? (
                  <>
                    <span className="h-4 w-4 rounded-full border-2 border-slate-400 border-t-slate-700 animate-spin" />
                    <span>Authenticating...</span>
                  </>
                ) : (
                  <>
                    <span>Sign In to Workspace</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>

              <p className="text-center text-slate-400 text-[11px] pt-2">
                Authorized personnel only. Contact your plant administrator for account access.
              </p>
            </form>
          ) : (
            <div className="space-y-5 rounded-2xl border border-slate-200 bg-slate-50/70 p-6 animate-tab-enter">
              <div className="flex items-center gap-2 text-xs font-bold text-emerald-700">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>Code expires in 5 minutes</span>
              </div>

              <form onSubmit={handleOtpSubmit} className="space-y-4">
                <div className="grid grid-cols-6 gap-2 sm:gap-3">
                  {Array.from({ length: 6 }, (_, i) => (
                    <input
                      key={i}
                      type="text"
                      inputMode="numeric"
                      maxLength={1}
                      value={otpValues[i]}
                      onChange={e => handleInputChange(e, i)}
                      ref={el => {
                        otpInputRefs.current[i] = el;
                      }}
                      className="h-12 sm:h-14 rounded-xl border-2 border-slate-200 bg-white text-center text-xl font-black font-mono text-slate-900 transition-all focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                    />
                  ))}
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  className={`w-full inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-xs font-black uppercase tracking-wider transition-all ${
                    isLoading
                      ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                      : 'bg-emerald-600 text-white hover:bg-emerald-700'
                  }`}
                >
                  {isLoading ? 'Verifying...' : 'Verify & Continue'}
                  <ArrowRight className="w-4 h-4" />
                </button>
              </form>

              <div className="flex items-center justify-between pt-1">
                {resendCooldown !== null ? (
                  <span className="text-slate-500 text-xs">
                    Resend available in <b className="font-mono text-slate-800">{resendCooldown}s</b>
                  </span>
                ) : (
                  <span className="text-slate-400 text-xs">Didn&apos;t receive the email?</span>
                )}
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={resendCooldown !== null}
                  className="text-xs font-bold text-emerald-700 hover:text-emerald-800 disabled:text-slate-400 transition-colors"
                >
                  Resend OTP
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
