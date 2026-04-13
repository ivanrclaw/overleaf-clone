import { Link } from 'react-router-dom';
import { AnimatedGradientText } from '@/components/ui/animated-gradient-text';
import { ShimmerButton } from '@/components/ui/shimmer-button';
import { MagicCard } from '@/components/ui/magic-card';
import { Code, Zap, ShieldCheck, ArrowRight } from 'lucide-react';

export default function Landing() {
  return (
    <div className="min-h-screen">
      {/* Hero Section */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-brand-50 via-white to-purple-50 dark:from-gray-950 dark:via-gray-950 dark:to-purple-950/20" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-brand-200/30 via-transparent to-transparent dark:from-brand-900/20" />
        <div className="relative mx-auto max-w-7xl px-4 pb-20 pt-24 sm:px-6 sm:pt-32 lg:px-8">
          <div className="mx-auto max-w-3xl text-center">
            <div className="mb-6 inline-flex items-center rounded-full border border-brand-200 bg-brand-50 px-4 py-1.5 text-sm font-medium text-brand-700 dark:border-brand-800 dark:bg-brand-950 dark:text-brand-300">
              ✨ Now with real-time linting
            </div>
            <h1 className="text-5xl font-bold tracking-tight sm:text-6xl lg:text-7xl">
              Write LaTeX,{' '}
              <AnimatedGradientText>Beautifully</AnimatedGradientText>
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg text-gray-600 sm:text-xl dark:text-gray-400">
              The modern, collaborative LaTeX editor. Compile, lint, and write — all in your browser.
            </p>
            <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Link to="/register">
                <ShimmerButton className="px-8 py-4 text-base">
                  Get Started Free
                  <ArrowRight className="ml-2 h-4 w-4" />
                </ShimmerButton>
              </Link>
              <a
                href="#features"
                className="inline-flex items-center rounded-xl border border-gray-300 bg-white px-8 py-4 text-base font-medium text-gray-700 shadow-sm transition-all hover:bg-gray-50 hover:shadow dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                See How It Works
              </a>
            </div>
          </div>

          {/* Editor preview mockup */}
          <div className="mx-auto mt-16 max-w-5xl">
            <div className="overflow-hidden rounded-xl border border-gray-200 shadow-2xl shadow-brand-500/10 dark:border-gray-800">
              <div className="flex items-center gap-2 border-b border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-800 dark:bg-gray-900">
                <div className="h-3 w-3 rounded-full bg-red-400" />
                <div className="h-3 w-3 rounded-full bg-yellow-400" />
                <div className="h-3 w-3 rounded-full bg-green-400" />
                <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">main.tex — TexFlow</span>
              </div>
              <div className="grid grid-cols-2 divide-x divide-gray-200 dark:divide-gray-800">
                <div className="bg-[#282c34] p-4">
                  <pre className="text-left text-sm leading-relaxed">
                    <code>
                      <span className="text-[#e06c75]">\documentclass</span>
                      <span className="text-[#abb2bf]">{'{article}'}</span>
                      {'\n'}
                      <span className="text-[#e06c75]">\usepackage</span>
                      <span className="text-[#abb2bf]">{'{amsmath}'}</span>
                      {'\n\n'}
                      <span className="text-[#c678dd]">\begin</span>
                      <span className="text-[#abb2bf]">{'{document}'}</span>
                      {'\n\n'}
                      <span className="text-[#98c379]">{'  % Your content here'}</span>
                      {'\n'}
                      <span className="text-[#e06c75]">{'  '}\section</span>
                      <span className="text-[#98c379]">{'{Introduction}'}</span>
                      {'\n'}
                      <span className="text-[#abb2bf]">{'  Hello, TexFlow!'}</span>
                      {'\n\n'}
                      <span className="text-[#c678dd]">\end</span>
                      <span className="text-[#abb2bf]">{'{document}'}</span>
                    </code>
                  </pre>
                </div>
                <div className="flex items-center justify-center bg-white p-8 dark:bg-gray-950">
                  <div className="text-center">
                    <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-brand-100 dark:bg-brand-900">
                      <svg className="h-8 w-8 text-brand-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                    </div>
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300">PDF Preview</p>
                    <p className="mt-1 text-xs text-gray-400">Compile to see output</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="border-t border-gray-100 bg-white py-20 dark:border-gray-800 dark:bg-gray-950">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Everything you need to write <span className="text-brand-600">LaTeX</span>
            </h2>
            <p className="mt-4 text-lg text-gray-500 dark:text-gray-400">
              Powerful features designed for productivity. No setup required.
            </p>
          </div>

          <div className="mt-16 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            <MagicCard className="group">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-brand-100 transition-colors group-hover:bg-brand-200 dark:bg-brand-900 dark:group-hover:bg-brand-800">
                <Code className="h-6 w-6 text-brand-600 dark:text-brand-400" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Smart Editor</h3>
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                CodeMirror-powered with full LaTeX syntax highlighting, bracket matching, and intelligent autocompletion. Write faster with fewer errors.
              </p>
            </MagicCard>

            <MagicCard className="group">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-purple-100 transition-colors group-hover:bg-purple-200 dark:bg-purple-900 dark:group-hover:bg-purple-800">
                <Zap className="h-6 w-6 text-purple-600 dark:text-purple-400" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Instant Compilation</h3>
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                Compile your LaTeX to PDF with one click using Tectonic. See your output instantly — no local installation needed.
              </p>
            </MagicCard>

            <MagicCard className="group">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-emerald-100 transition-colors group-hover:bg-emerald-200 dark:bg-emerald-900 dark:group-hover:bg-emerald-800">
                <ShieldCheck className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Full Linting</h3>
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                Catch errors before compiling with Chktex integration. Real-time diagnostics highlight issues as you type.
              </p>
            </MagicCard>
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="border-t border-gray-100 bg-gradient-to-b from-white to-brand-50/50 py-16 dark:border-gray-800 dark:from-gray-950 dark:to-brand-950/10">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
            {[
              { value: '10K+', label: 'Documents Compiled' },
              { value: '5K+', label: 'Active Users' },
              { value: '99.9%', label: 'Uptime' },
              { value: '<2s', label: 'Compile Time' },
            ].map((stat) => (
              <div key={stat.label} className="text-center">
                <div className="text-3xl font-bold text-brand-600 sm:text-4xl">{stat.value}</div>
                <div className="mt-1 text-sm text-gray-500 dark:text-gray-400">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="border-t border-gray-100 bg-gradient-to-r from-brand-600 to-purple-600 py-16 dark:border-gray-800">
        <div className="mx-auto max-w-4xl px-4 text-center sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Ready to write?
          </h2>
          <p className="mt-4 text-lg text-brand-100">
            Join thousands of researchers, students, and engineers writing LaTeX with TexFlow.
          </p>
          <div className="mt-8">
            <Link to="/register">
              <ShimmerButton className="border-2 border-white/20 bg-white/10 px-8 py-4 text-base backdrop-blur hover:bg-white/20">
                Start Writing Now
                <ArrowRight className="ml-2 h-4 w-4" />
              </ShimmerButton>
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-100 bg-white py-8 dark:border-gray-800 dark:bg-gray-950">
        <div className="mx-auto max-w-7xl px-4 text-center sm:px-6 lg:px-8">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            © {new Date().getFullYear()} TexFlow. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}