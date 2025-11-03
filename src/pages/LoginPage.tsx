import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useNavigate } from '../hooks/useNavigate';
import {
  Brain,
  Sparkles,
  BookOpen,
  Zap,
  CheckCircle,
  Mail,
  Lock,
  ArrowRight,
  Clock,
} from 'lucide-react';

export default function LoginPage() {
  const navigate = useNavigate();
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isSignUp) {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin,
          },
        });
        if (error) throw error;
        alert('Check your email to confirm your account!');
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        navigate('dashboard');
      }
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 flex">
      {/* Left Side - Value Proposition */}
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-blue-600 via-purple-600 to-blue-700 p-12 flex-col justify-between relative overflow-hidden">
        {/* Decorative Elements */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-white/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2"></div>
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-purple-400/20 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2"></div>

        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-12">
            <div className="w-12 h-12 bg-white/20 backdrop-blur-sm rounded-xl flex items-center justify-center">
              <Brain className="w-7 h-7 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-white">LectureLens</h1>
          </div>

          <div className="space-y-8">
            <div>
              <h2 className="text-4xl font-bold text-white mb-4 leading-tight">
                Transform Your Lectures Into
                <br />
                <span className="text-blue-200">Instant Study Guides</span>
              </h2>
              <p className="text-blue-100 text-lg leading-relaxed">
                Join thousands of students who are learning smarter with AI-powered lecture analysis
              </p>
            </div>

            <div className="space-y-4 pt-4">
              {[
                {
                  icon: Sparkles,
                  title: 'AI-Generated Summaries',
                  desc: 'Get comprehensive summaries in seconds',
                },
                {
                  icon: BookOpen,
                  title: 'Smart Flashcards',
                  desc: 'Auto-created from your lecture content',
                },
                {
                  icon: Zap,
                  title: 'Instant Key Points',
                  desc: 'Never miss important concepts again',
                },
                {
                  icon: Brain,
                  title: '24/7 AI Tutor',
                  desc: 'Get answers to your questions anytime',
                },
              ].map((feature, idx) => (
                <div key={idx} className="flex items-start gap-4 p-4 bg-white/10 backdrop-blur-sm rounded-xl">
                  <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center flex-shrink-0">
                    <feature.icon className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h3 className="text-white font-semibold mb-1">{feature.title}</h3>
                    <p className="text-blue-100 text-sm">{feature.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="relative z-10">
          <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 border border-white/20">
            <div className="flex items-center gap-3 mb-3">
              <CheckCircle className="w-5 h-5 text-green-300" />
              <span className="text-white font-semibold">Free to Start</span>
            </div>
            <p className="text-blue-100 text-sm">
              Upload your first 10 lectures free. No credit card required.
            </p>
          </div>
        </div>
      </div>

      {/* Right Side - Authentication Form */}
      <div className="flex-1 flex items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-md">
          {/* Mobile Logo */}
          <div className="lg:hidden flex items-center justify-center gap-3 mb-8">
            <div className="w-12 h-12 bg-gradient-to-br from-blue-600 to-purple-600 rounded-xl flex items-center justify-center">
              <Brain className="w-7 h-7 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900">LectureLens</h1>
          </div>

          {/* Urgency Banner */}
          <div className="bg-gradient-to-r from-orange-50 to-amber-50 border-2 border-orange-200 rounded-xl p-4 mb-6">
            <div className="flex items-start gap-3">
              <Clock className="w-5 h-5 text-orange-600 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="font-semibold text-orange-900 mb-1">Limited Time: Early Access</h3>
                <p className="text-sm text-orange-800">
                  Sign up now to lock in <strong>unlimited uploads</strong> for your first semester
                </p>
              </div>
            </div>
          </div>

          {/* Auth Card */}
          <div className="bg-white rounded-2xl shadow-xl p-8 border border-slate-200">
            <div className="text-center mb-8">
              <h2 className="text-3xl font-bold text-slate-900 mb-2">
                {isSignUp ? 'Create Your Account' : 'Welcome Back'}
              </h2>
              <p className="text-slate-600">
                {isSignUp
                  ? 'Start transforming your lectures today'
                  : 'Continue your learning journey'}
              </p>
            </div>

            {error && (
              <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm text-red-800">{error}</p>
              </div>
            )}

            <form onSubmit={handleAuth} className="space-y-5">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-2">
                  Email Address
                </label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="w-full pl-12 pr-4 py-3 border-2 border-slate-200 rounded-xl focus:border-blue-500 focus:ring-4 focus:ring-blue-100 transition outline-none text-slate-900"
                    placeholder="you@university.edu"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-medium text-slate-700 mb-2">
                  Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                  <input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                    className="w-full pl-12 pr-4 py-3 border-2 border-slate-200 rounded-xl focus:border-blue-500 focus:ring-4 focus:ring-blue-100 transition outline-none text-slate-900"
                    placeholder="••••••••"
                  />
                </div>
                {isSignUp && (
                  <p className="text-xs text-slate-500 mt-2">Must be at least 6 characters</p>
                )}
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-gradient-to-r from-blue-600 to-purple-600 text-white py-4 rounded-xl font-semibold text-lg hover:from-blue-700 hover:to-purple-700 transition-all shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 group"
              >
                {loading ? (
                  <span>Processing...</span>
                ) : (
                  <>
                    <span>{isSignUp ? 'Start Learning Smarter' : 'Sign In'}</span>
                    <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                  </>
                )}
              </button>
            </form>

            {/* Benefits Reminder */}
            {isSignUp && (
              <div className="mt-6 pt-6 border-t border-slate-200">
                <p className="text-xs text-slate-600 mb-3 font-medium">What you get instantly:</p>
                <div className="space-y-2">
                  {['AI lecture summaries', 'Smart flashcard generation', '24/7 AI tutor access'].map(
                    (benefit, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0" />
                        <span className="text-sm text-slate-700">{benefit}</span>
                      </div>
                    )
                  )}
                </div>
              </div>
            )}

            {/* Toggle Auth Mode */}
            <div className="mt-6 text-center">
              <button
                type="button"
                onClick={() => {
                  setIsSignUp(!isSignUp);
                  setError('');
                }}
                className="text-sm text-slate-600 hover:text-blue-600 transition"
              >
                {isSignUp ? (
                  <>
                    Already have an account?{' '}
                    <span className="font-semibold text-blue-600">Sign in</span>
                  </>
                ) : (
                  <>
                    Don't have an account?{' '}
                    <span className="font-semibold text-blue-600">Sign up free</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Trust Indicators */}
          <div className="mt-8 text-center">
            <p className="text-sm text-slate-500 mb-3">Trusted by students at</p>
            <div className="flex items-center justify-center gap-6 text-slate-400 text-xs font-medium">
              <span>Stanford</span>
              <span>•</span>
              <span>MIT</span>
              <span>•</span>
              <span>Harvard</span>
              <span>•</span>
              <span>200+ Universities</span>
            </div>
          </div>

          {/* Privacy Note */}
          <p className="mt-6 text-xs text-center text-slate-500">
            By signing up, you agree to our Terms of Service and Privacy Policy.
            <br />
            We respect your privacy and never share your data.
          </p>
        </div>
      </div>
    </div>
  );
}
