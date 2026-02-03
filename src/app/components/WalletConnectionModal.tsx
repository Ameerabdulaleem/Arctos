import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog"
import { Wallet, Shield, Key, UserPlus } from 'lucide-react'
import { useState } from 'react'

interface WalletConnectionModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const walletOptions = [
  { id: 'metamask', name: 'MetaMask', icon: Wallet, description: 'Connect using MetaMask', color: 'bg-orange-500' },
  { id: 'phantom', name: 'Phantom', icon: Shield, description: 'Connect using Phantom', color: 'bg-purple-500' },
  { id: 'rabby', name: 'Rabby Wallet', icon: Key, description: 'Connect using Rabby', color: 'bg-blue-500' },
  { id: 'okx', name: 'OKX Wallet', icon: Wallet, description: 'Connect using OKX', color: 'bg-green-500' },
  { id: 'create', name: 'Create Wallet', icon: UserPlus, description: 'Create a new wallet', color: 'bg-gray-500' },
]

export function WalletConnectionModal({ open, onOpenChange }: WalletConnectionModalProps) {
  const [connecting, setConnecting] = useState(false)

  const handleWalletSelect = async (walletId: string) => {
    setConnecting(true)
    console.log(`Connecting to ${walletId}...`)
    
    // Simulate connection delay
    await new Promise(resolve => setTimeout(resolve, 1000))
    
    setConnecting(false)
    onOpenChange(false)
    alert(`Successfully connected to ${walletId}!`)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold text-center">Connect Your Wallet</DialogTitle>
          <p className="text-center text-gray-500 dark:text-gray-400">
            Choose your preferred wallet to connect to Arctos
          </p>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {walletOptions.map((wallet) => {
            const Icon = wallet.icon
            return (
              <button
                key={wallet.id}
                onClick={() => handleWalletSelect(wallet.id)}
                disabled={connecting}
                className="w-full p-4 rounded-xl border border-gray-200 dark:border-gray-800 hover:border-blue-500 dark:hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all flex items-center gap-4 disabled:opacity-50"
              >
                <div className={`w-12 h-12 rounded-lg ${wallet.color} flex items-center justify-center`}>
                  <Icon className="w-6 h-6 text-white" />
                </div>
                <div className="text-left flex-1">
                  <h3 className="font-bold text-lg">{wallet.name}</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400">{wallet.description}</p>
                </div>
                {connecting && (
                  <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                )}
              </button>
            )
          })}
        </div>

        <div className="text-center text-sm text-gray-500 dark:text-gray-400">
          <p>By connecting, you agree to our Terms of Service and Privacy Policy</p>
        </div>
      </DialogContent>
    </Dialog>
  )
}