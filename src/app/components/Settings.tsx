import { useState } from 'react';
import { Settings as SettingsIcon, Globe, Moon, Sun, Bell, Shield, User, Palette } from 'lucide-react';

interface SettingsProps {
  theme: 'dark' | 'light';
  setTheme: (theme: 'dark' | 'light') => void;
  language: string;
  setLanguage: (language: string) => void;
}

export function Settings({ theme, setTheme, language, setLanguage }: SettingsProps) {
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [pushNotifications, setPushNotifications] = useState(true);
  const [tradeAlerts, setTradeAlerts] = useState(true);

  const isDark = theme === 'dark';

  const languages = [
    { code: 'en', name: 'English', flag: '🇺🇸' },
    { code: 'es', name: 'Español', flag: '🇪🇸' },
    { code: 'fr', name: 'Français', flag: '🇫🇷' },
    { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
    { code: 'zh', name: '中文', flag: '🇨🇳' },
    { code: 'ja', name: '日本語', flag: '🇯🇵' },
    { code: 'ko', name: '한국어', flag: '🇰🇷' },
    { code: 'pt', name: 'Português', flag: '🇵🇹' },
    { code: 'ru', name: 'Русский', flag: '🇷🇺' },
    { code: 'ar', name: 'العربية', flag: '🇸🇦' },
  ];

  return (
    <div className={`h-full ${isDark ? 'bg-black' : 'bg-white'} p-6 overflow-auto`}>
      {/* Header */}
      <div className="mb-6">
        <h1 className={`text-3xl font-bold ${isDark ? 'text-white' : 'text-gray-900'} mb-2 flex items-center gap-3`}>
          <SettingsIcon className="w-8 h-8 text-blue-500" />
          Settings
        </h1>
        <p className={isDark ? 'text-zinc-400' : 'text-gray-600'}>Customize your dashboard preferences</p>
      </div>

      <div className="max-w-4xl space-y-6">
        {/* Appearance Settings */}
        <div className={`${isDark ? 'bg-zinc-900 border-zinc-800' : 'bg-gray-50 border-gray-200'} border rounded-xl p-6`}>
          <div className="flex items-center gap-3 mb-6">
            <Palette className="w-5 h-5 text-blue-500" />
            <h2 className={`text-xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>Appearance</h2>
          </div>

          {/* Theme Toggle */}
          <div className="mb-6">
            <label className={`${isDark ? 'text-white' : 'text-gray-900'} font-medium mb-3 block`}>Theme</label>
            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={() => setTheme('dark')}
                className={`p-4 rounded-lg border-2 transition-all ${
                  theme === 'dark'
                    ? 'border-blue-600 bg-blue-600/10'
                    : isDark
                      ? 'border-zinc-700 bg-zinc-800 hover:border-zinc-600'
                      : 'border-gray-300 bg-white hover:border-gray-400'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`p-3 ${isDark ? 'bg-zinc-700' : 'bg-gray-200'} rounded-lg`}>
                    <Moon className="w-6 h-6 text-blue-400" />
                  </div>
                  <div className="text-left">
                    <p className={`${isDark ? 'text-white' : 'text-gray-900'} font-medium`}>Dark Mode</p>
                    <p className={`${isDark ? 'text-zinc-400' : 'text-gray-600'} text-sm`}>Easy on the eyes</p>
                  </div>
                </div>
                {theme === 'dark' && (
                  <div className="mt-3 flex justify-end">
                    <div className="w-5 h-5 bg-blue-600 rounded-full flex items-center justify-center">
                      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                  </div>
                )}
              </button>

              <button
                onClick={() => setTheme('light')}
                className={`p-4 rounded-lg border-2 transition-all ${
                  theme === 'light'
                    ? 'border-blue-600 bg-blue-600/10'
                    : isDark
                      ? 'border-zinc-700 bg-zinc-800 hover:border-zinc-600'
                      : 'border-gray-300 bg-white hover:border-gray-400'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`p-3 ${isDark ? 'bg-zinc-700' : 'bg-gray-200'} rounded-lg`}>
                    <Sun className="w-6 h-6 text-yellow-400" />
                  </div>
                  <div className="text-left">
                    <p className={`${isDark ? 'text-white' : 'text-gray-900'} font-medium`}>Light Mode</p>
                    <p className={`${isDark ? 'text-zinc-400' : 'text-gray-600'} text-sm`}>Bright and clear</p>
                  </div>
                </div>
                {theme === 'light' && (
                  <div className="mt-3 flex justify-end">
                    <div className="w-5 h-5 bg-blue-600 rounded-full flex items-center justify-center">
                      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                  </div>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Language Settings */}
        <div className={`${isDark ? 'bg-zinc-900 border-zinc-800' : 'bg-gray-50 border-gray-200'} border rounded-xl p-6`}>
          <div className="flex items-center gap-3 mb-6">
            <Globe className="w-5 h-5 text-blue-500" />
            <h2 className={`text-xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>Language & Region</h2>
          </div>

          <div>
            <label className={`${isDark ? 'text-white' : 'text-gray-900'} font-medium mb-3 block`}>Display Language</label>
            <div className="grid grid-cols-2 gap-3">
              {languages.map((lang) => (
                <button
                  key={lang.code}
                  onClick={() => setLanguage(lang.code)}
                  className={`p-4 rounded-lg border transition-all text-left ${
                    language === lang.code
                      ? 'border-blue-600 bg-blue-600/10'
                      : isDark
                        ? 'border-zinc-700 bg-zinc-800 hover:border-zinc-600 hover:bg-zinc-750'
                        : 'border-gray-300 bg-white hover:border-gray-400 hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{lang.flag}</span>
                      <span className={`${isDark ? 'text-white' : 'text-gray-900'} font-medium`}>{lang.name}</span>
                    </div>
                    {language === lang.code && (
                      <div className="w-5 h-5 bg-blue-600 rounded-full flex items-center justify-center">
                        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Notification Settings */}
        <div className={`${isDark ? 'bg-zinc-900 border-zinc-800' : 'bg-gray-50 border-gray-200'} border rounded-xl p-6`}>
          <div className="flex items-center gap-3 mb-6">
            <Bell className="w-5 h-5 text-blue-500" />
            <h2 className={`text-xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>Notifications</h2>
          </div>

          <div className="space-y-4">
            <div className={`flex items-center justify-between p-4 ${isDark ? 'bg-zinc-800' : 'bg-white border border-gray-200'} rounded-lg`}>
              <div>
                <p className={`${isDark ? 'text-white' : 'text-gray-900'} font-medium`}>Email Notifications</p>
                <p className={`${isDark ? 'text-zinc-400' : 'text-gray-600'} text-sm`}>Receive updates via email</p>
              </div>
              <button
                onClick={() => setEmailNotifications(!emailNotifications)}
                className={`relative w-14 h-7 rounded-full transition-colors ${
                  emailNotifications ? 'bg-blue-600' : isDark ? 'bg-zinc-600' : 'bg-gray-300'
                }`}
              >
                <span
                  className={`absolute top-1 left-1 w-5 h-5 bg-white rounded-full transition-transform ${
                    emailNotifications ? 'translate-x-7' : ''
                  }`}
                ></span>
              </button>
            </div>

            <div className={`flex items-center justify-between p-4 ${isDark ? 'bg-zinc-800' : 'bg-white border border-gray-200'} rounded-lg`}>
              <div>
                <p className={`${isDark ? 'text-white' : 'text-gray-900'} font-medium`}>Push Notifications</p>
                <p className={`${isDark ? 'text-zinc-400' : 'text-gray-600'} text-sm`}>Get instant alerts</p>
              </div>
              <button
                onClick={() => setPushNotifications(!pushNotifications)}
                className={`relative w-14 h-7 rounded-full transition-colors ${
                  pushNotifications ? 'bg-blue-600' : isDark ? 'bg-zinc-600' : 'bg-gray-300'
                }`}
              >
                <span
                  className={`absolute top-1 left-1 w-5 h-5 bg-white rounded-full transition-transform ${
                    pushNotifications ? 'translate-x-7' : ''
                  }`}
                ></span>
              </button>
            </div>

            <div className={`flex items-center justify-between p-4 ${isDark ? 'bg-zinc-800' : 'bg-white border border-gray-200'} rounded-lg`}>
              <div>
                <p className={`${isDark ? 'text-white' : 'text-gray-900'} font-medium`}>Trade Alerts</p>
                <p className={`${isDark ? 'text-zinc-400' : 'text-gray-600'} text-sm`}>Notifications for trade executions</p>
              </div>
              <button
                onClick={() => setTradeAlerts(!tradeAlerts)}
                className={`relative w-14 h-7 rounded-full transition-colors ${
                  tradeAlerts ? 'bg-blue-600' : isDark ? 'bg-zinc-600' : 'bg-gray-300'
                }`}
              >
                <span
                  className={`absolute top-1 left-1 w-5 h-5 bg-white rounded-full transition-transform ${
                    tradeAlerts ? 'translate-x-7' : ''
                  }`}
                ></span>
              </button>
            </div>
          </div>
        </div>

        {/* Account Settings */}
        <div className={`${isDark ? 'bg-zinc-900 border-zinc-800' : 'bg-gray-50 border-gray-200'} border rounded-xl p-6`}>
          <div className="flex items-center gap-3 mb-6">
            <User className="w-5 h-5 text-blue-500" />
            <h2 className={`text-xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>Account</h2>
          </div>

          <div className="space-y-3">
            <button className={`w-full p-4 ${isDark ? 'bg-zinc-800 text-white hover:bg-zinc-700' : 'bg-white border border-gray-200 text-gray-900 hover:bg-gray-50'} rounded-lg transition-colors text-left`}>
              <p className="font-medium">Profile Settings</p>
              <p className={`${isDark ? 'text-zinc-400' : 'text-gray-600'} text-sm`}>Manage your personal information</p>
            </button>
            <button className={`w-full p-4 ${isDark ? 'bg-zinc-800 text-white hover:bg-zinc-700' : 'bg-white border border-gray-200 text-gray-900 hover:bg-gray-50'} rounded-lg transition-colors text-left`}>
              <p className="font-medium">Change Password</p>
              <p className={`${isDark ? 'text-zinc-400' : 'text-gray-600'} text-sm`}>Update your account password</p>
            </button>
          </div>
        </div>

        {/* Security Settings */}
        <div className={`${isDark ? 'bg-zinc-900 border-zinc-800' : 'bg-gray-50 border-gray-200'} border rounded-xl p-6`}>
          <div className="flex items-center gap-3 mb-6">
            <Shield className="w-5 h-5 text-blue-500" />
            <h2 className={`text-xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>Security</h2>
          </div>

          <div className="space-y-3">
            <button className={`w-full p-4 ${isDark ? 'bg-zinc-800 text-white hover:bg-zinc-700' : 'bg-white border border-gray-200 text-gray-900 hover:bg-gray-50'} rounded-lg transition-colors text-left`}>
              <p className="font-medium">Two-Factor Authentication</p>
              <p className={`${isDark ? 'text-zinc-400' : 'text-gray-600'} text-sm`}>Add an extra layer of security</p>
            </button>
            <button className={`w-full p-4 ${isDark ? 'bg-zinc-800 text-white hover:bg-zinc-700' : 'bg-white border border-gray-200 text-gray-900 hover:bg-gray-50'} rounded-lg transition-colors text-left`}>
              <p className="font-medium">API Keys</p>
              <p className={`${isDark ? 'text-zinc-400' : 'text-gray-600'} text-sm`}>Manage your API access</p>
            </button>
            <button className={`w-full p-4 ${isDark ? 'bg-zinc-800 text-white hover:bg-zinc-700' : 'bg-white border border-gray-200 text-gray-900 hover:bg-gray-50'} rounded-lg transition-colors text-left`}>
              <p className="font-medium">Connected Wallets</p>
              <p className={`${isDark ? 'text-zinc-400' : 'text-gray-600'} text-sm`}>View and manage connected wallets</p>
            </button>
          </div>
        </div>

        {/* Save Button */}
        <div className="flex justify-end gap-3">
          <button className={`px-6 py-3 ${isDark ? 'bg-zinc-800 text-white hover:bg-zinc-700' : 'bg-white border border-gray-200 text-gray-900 hover:bg-gray-50'} rounded-lg transition-colors`}>
            Cancel
          </button>
          <button className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium">
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}