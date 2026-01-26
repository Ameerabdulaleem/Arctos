import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog"
import { Mail, Lock, User } from 'lucide-react'
import { useState } from 'react'

interface EmailAuthModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function EmailAuthModal({ open, onOpenChange }: EmailAuthModalProps) {
  const [isLogin, setIsLogin] = useState(true)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 1500))
    
    setLoading(false)
    onOpenChange(false)
    alert(isLogin ? 'Successfully logged in!' : 'Account created successfully!')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold text-center">
            {isLogin ? 'Welcome Back' : 'Create Account'}
          </DialogTitle>
          <p className="text-center text-gray-500 dark:text-gray-400">
            {isLogin ? 'Sign in to access your dashboard' : 'Join Arctos to start trading'}
          </p>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          {!isLogin && (
            <div>
              <label className="block text-sm font-medium mb-2">Full Name</label>
              <div className="relative">
                <User className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  placeholder="John Doe"
                  required
                  className="w-full pl-10 p-3 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-2">Email Address</label>
            <div className="relative">
              <Mail className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
              <input
                type="email"
                placeholder="you@example.com"
                required
                className="w-full pl-10 p-3 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Password</label>
            <div className="relative">
              <Lock className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
              <input
                type="password"
                placeholder="••••••••"
                required
                className="w-full pl-10 p-3 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
              />
            </div>
          </div>

          {isLogin && (
            <div className="flex justify-between items-center">
              <label className="flex items-center gap-2">
                <input type="checkbox" className="rounded" />
                <span className="text-sm">Remember me</span>
              </label>
              <button type="button" className="text-sm text-blue-500 hover:text-blue-600">
                Forgot password?
              </button>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <div className="flex items-center justify-center gap-2">
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                {isLogin ? 'Signing in...' : 'Creating account...'}
              </div>
            ) : (
              isLogin ? 'Sign In' : 'Create Account'
            )}
          </button>
        </form>

        <div className="text-center">
          <button
            type="button"
            onClick={() => setIsLogin(!isLogin)}
            className="text-blue-500 hover:text-blue-600 text-sm"
          >
            {isLogin ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}