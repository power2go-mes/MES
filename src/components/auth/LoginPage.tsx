import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';

const LoginPage: React.FC = () => {
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
    }
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
    }
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
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-8">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-slate-900 mb-2">Power2Go MES</h1>
          <h2 className="text-slate-500 text-base">Sign in to your account</h2>
        </div>

        {error && (
          <div className="bg-red-950 text-white rounded p-3 mb-4 text-center">
            {error}
          </div>
        )}

        {!verifyingOtp && (
          <form className="space-y-4" onSubmit={handleLogin}>
            <div>
              <label className="block text-slate-600 text-sm font-medium mb-2">
                Username or Email
              </label>
              <input
                type="text"
                name="identifier"
                value={identifier}
                onChange={e => handleInputChange(e)}
                placeholder="nina.v@example.com"
                required
                className={`w-full rounded border p-3 focus:ring-2 focus:ring-slate-300 focus:border-transparent ${
                  error ? 'bg-red-50' : 'bg-white'
                }`}
              />
            </div>

            <div>
              <label className="block text-slate-600 text-sm font-medium mb-2">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  value={password}
                  onChange={e => handleInputChange(e)}
                  required
                  className={`w-full rounded border p-3 focus:ring-2 focus:ring-slate-300 focus:border-transparent ${
                    error ? 'bg-red-50' : 'bg-white'
                  }`}
                  placeholder="••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className={`w-full rounded border p-3 text-sm font-medium transition-colors ${
                isLoading
                  ? 'bg-slate-300 text-slate-600 cursor-not-allowed'
                  : 'bg-slate-900 text-white hover:bg-slate-800'
              }`}
            >
              {isLoading ? 'Signing in...' : 'Sign In'}
            </button>

            <p className="text-center text-slate-500 text-xs mt-2">
              Use your factory account. Contact an administrator for access.
            </p>
          </form>
        )}

        {verifyingOtp && (
          <div className="mt-6 p-6 bg-slate-50 rounded-xl">
            <h3 className="text-slate-700 font-medium mb-4">Power2Go MES</h3>
            <p className="text-slate-500 text-sm mb-6">
              Verification code sent to your registered email.
              <br />
              This code expires in 5 minutes.
            </p>

            <form onSubmit={handleOtpSubmit} className="space-y-3">
              <div className="grid grid-cols-6 gap-2">
                {Array.from({ length: 6 }, (_, i) => (
                  <input
                    key={i}
                    type="text"
                    maxLength={1}
                    value={otpValues[i]}
                    onChange={e => handleInputChange(e, i)}
                    ref={el => {
                      otpInputRefs.current[i] = el;
                    }}
                    className="rounded border p-2 text-center text-2xl font-medium focus:ring-2 focus:ring-slate-300 focus:border-transparent"
                  />
                ))}
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className={`w-full rounded border p-3 text-sm font-medium transition-colors ${
                  isLoading
                    ? 'bg-slate-300 text-slate-600 cursor-not-allowed'
                    : 'bg-slate-900 text-white hover:bg-slate-800'
                }`}
              >
                Verify
              </button>
            </form>

            {resendCooldown !== null && (
              <p className="text-center text-slate-500 text-xs mt-4">
                Resend available in <span className="font-medium">{resendCooldown}</span>s
              </p>
            )}

            <button
              onClick={handleResend}
              className="mt-3 w-full text-sm text-slate-400 hover:text-slate-600 rounded border p-2"
            >
              Resend OTP
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default LoginPage;
