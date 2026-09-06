/** Public Talos identity. Deployment-specific links are supplied by the operator. */
export const brand = {
    name: 'Talos',
    command: 'talos',
    scheme: 'talos',
    description: 'Your agents. Your command.',
    repositoryUrl: process.env.EXPO_PUBLIC_TALOS_REPOSITORY_URL || null,
    supportUrl: process.env.EXPO_PUBLIC_TALOS_SUPPORT_URL || null,
    privacyUrl: process.env.EXPO_PUBLIC_TALOS_PRIVACY_URL || null,
    termsUrl: process.env.EXPO_PUBLIC_TALOS_TERMS_URL || null,
    installCommand: process.env.EXPO_PUBLIC_TALOS_INSTALL_COMMAND || 'npm install -g talosapp',
} as const;

export const talosPalette = {
    light: {
        background: '#F4F1EA', surface: '#FFFDFA', raised: '#EEE9DE',
        text: '#25231F', secondary: '#71695D', border: '#DDD5C7',
        accent: '#80551E', accentSoft: '#E9DDC8', onAccent: '#FFFFFF',
    },
    dark: {
        background: '#141413', surface: '#1C1C1A', raised: '#272621',
        text: '#F2EEE5', secondary: '#B3AB9C', border: '#38342C',
        accent: '#D9AE68', accentSoft: '#352C1D', onAccent: '#211A10',
    },
};
