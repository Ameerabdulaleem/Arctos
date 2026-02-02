import { WalletType } from '../contexts/AuthContext'

// Check if we're in mock mode
const IS_MOCK = import.meta.env.VITE_APP_WALLET_CONNECTION_MOCK === 'true'

export interface WalletConnection {
  address: string
  chainId: number
  walletType: WalletType
  connected: boolean
}

class WalletService {
  // REAL wallet connection implementations
  async connectMetaMask(): Promise<WalletConnection> {
    if (IS_MOCK) {
      // Development mock
      return this.mockWalletConnection('metamask')
    }
    
    // REAL MetaMask connection
    if (!window.ethereum) {
      throw new Error('MetaMask not installed')
    }
    
    try {
      const accounts = await window.ethereum.request({ 
        method: 'eth_requestAccounts' 
      })
      
      const chainId = await window.ethereum.request({ 
        method: 'eth_chainId' 
      })
      
      return {
        address: accounts[0],
        chainId: parseInt(chainId, 16),
        walletType: 'metamask',
        connected: true
      }
    } catch (error) {
      console.error('MetaMask connection error:', error)
      throw error
    }
  }

  async connectPhantom(): Promise<WalletConnection> {
    if (IS_MOCK) {
      return this.mockWalletConnection('phantom')
    }
    
    // REAL Phantom connection
    if (!window.phantom?.solana) {
      throw new Error('Phantom wallet not installed')
    }
    
    try {
      const resp = await window.phantom.solana.connect()
      return {
        address: resp.publicKey.toString(),
        chainId: 101, // Mainnet
        walletType: 'phantom',
        connected: true
      }
    } catch (error) {
      console.error('Phantom connection error:', error)
      throw error
    }
  }

  async connectRabby(): Promise<WalletConnection> {
    if (IS_MOCK) {
      return this.mockWalletConnection('rabby')
    }
    
    // REAL Rabby connection (EVM compatible)
    if (!window.ethereum) {
      throw new Error('No EVM wallet detected')
    }
    
    try {
      const accounts = await window.ethereum.request({ 
        method: 'eth_requestAccounts' 
      })
      
      const chainId = await window.ethereum.request({ 
        method: 'eth_chainId' 
      })
      
      return {
        address: accounts[0],
        chainId: parseInt(chainId, 16),
        walletType: 'rabby',
        connected: true
      }
    } catch (error) {
      console.error('Rabby connection error:', error)
      throw error
    }
  }

  async connectOKX(): Promise<WalletConnection> {
    if (IS_MOCK) {
      return this.mockWalletConnection('okx')
    }
    
    // REAL OKX connection
    if (!window.okxwallet) {
      throw new Error('OKX Wallet not installed')
    }
    
    try {
      const accounts = await window.okxwallet.request({ 
        method: 'eth_requestAccounts' 
      })
      
      const chainId = await window.okxwallet.request({ 
        method: 'eth_chainId' 
      })
      
      return {
        address: accounts[0],
        chainId: parseInt(chainId, 16),
        walletType: 'okx',
        connected: true
      }
    } catch (error) {
      console.error('OKX connection error:', error)
      throw error
    }
  }

  // Helper method for mock data
  private mockWalletConnection(walletType: WalletType): WalletConnection {
    const mockAddresses = {
      metamask: `0x${Math.random().toString(16).substring(2, 10)}...${Math.random().toString(16).substring(2, 6)}`,
      phantom: `${Math.random().toString(36).substring(2, 10)}...${Math.random().toString(36).substring(2, 6)}`,
      rabby: `0x${Math.random().toString(16).substring(2, 10)}...${Math.random().toString(16).substring(2, 6)}`,
      okx: `0x${Math.random().toString(16).substring(2, 10)}...${Math.random().toString(16).substring(2, 6)}`,
      nightly: `${Math.random().toString(36).substring(2, 10)}...${Math.random().toString(36).substring(2, 6)}`
    }

    return {
      address: mockAddresses[walletType!] || 'mock_address',
      chainId: walletType === 'phantom' ? 101 : 1,
      walletType,
      connected: true
    }
  }

  // Check if wallets are available
  isMetaMaskAvailable(): boolean {
    return IS_MOCK || !!window.ethereum
  }

  isPhantomAvailable(): boolean {
    return IS_MOCK || !!window.phantom?.solana
  }

  isRabbyAvailable(): boolean {
    return IS_MOCK || !!window.ethereum
  }

  isOKXAvailable(): boolean {
    return IS_MOCK || !!window.okxwallet
  }
}

export const walletService = new WalletService()