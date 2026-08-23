import Image from "next/image";
import type { CSSProperties } from "react";
import tenant from "../../config/tenant.demo.json";
import { WebCallControl, WebCallProvider } from "./components/web-call";

type BrandStyle = CSSProperties & Record<`--${string}`, string>;

function actionLink(label: string, href: string, className: string) {
  return <a className={className} href={href}>{label}</a>;
}

export default function HomePage() {
  const site = tenant.website;
  const monthlyMissedCalls = Math.round(
    site.missedCalls.missedCallsPerWeek
      * site.missedCalls.weeksPerYear
      / site.missedCalls.monthsPerYear
  );
  const brandStyle: BrandStyle = {
    "--brand-primary": tenant.branding.primary,
    "--brand-accent": tenant.branding.accent,
    "--brand-surface": tenant.branding.surface,
    "--brand-ink": tenant.branding.ink,
    "--font-display": tenant.branding.fontDisplay,
    "--font-body": tenant.branding.fontBody
  };

  return (
    <WebCallProvider>
    <main style={brandStyle}>
      <nav className="nav" aria-label="Hauptnavigation">
        <a className="wordmark" href="#top" aria-label={`${tenant.salonName} Startseite`}>
          <span aria-hidden="true">{tenant.salonName.charAt(0)}</span>
          {tenant.branding.logoText}
        </a>
        <div className="nav-links">
          <a href="#impact">{site.navigation.impactLabel}</a>
          <a href="#features">{site.navigation.featuresLabel}</a>
          <a href="#contact">{site.navigation.contactLabel}</a>
        </div>
        <a className="phone-link" href={tenant.links.demoAgent}>{tenant.contact.phone}</a>
      </nav>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">{site.hero.eyebrow}</p>
          <h1>{site.hero.headline}</h1>
          <p className="hero-body">{site.hero.body}</p>
          <div className="actions">
            <WebCallControl buttonClassName="button-primary" />
            {actionLink(site.hero.secondaryCtaLabel, tenant.links.consultation, "button button-secondary")}
          </div>
        </div>
        <div className="hero-media">
          <Image
            src="/salon-hero.png"
            alt={site.hero.imageAlt}
            fill
            priority
            sizes="(max-width: 800px) 100vw, 52vw"
          />
        </div>
      </section>

      <section className="impact" id="impact">
        <div className="impact-copy">
          <h2>{site.missedCalls.headline}</h2>
          <p>{site.missedCalls.body}</p>
        </div>
        <div className="impact-stats" aria-label="Verpasste Anrufe">
          <article className="stat stat-primary">
            <strong>{site.missedCalls.missedCallsPerWeek}</strong>
            <span>{site.missedCalls.weeklyLabel}</span>
          </article>
          <article className="stat">
            <strong>~{monthlyMissedCalls}</strong>
            <span>{site.missedCalls.monthlyLabel}</span>
          </article>
        </div>
      </section>

      <section className="features" id="features">
        <div className="features-heading">
          <h2>{site.featuresHeading}</h2>
        </div>
        <div className="feature-grid">
          {site.features.map((feature, index) => (
            <article className={`feature feature-${index + 1}`} key={feature.title}>
              <h3>{feature.title}</h3>
              <p>{feature.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="final-cta" id="contact">
        <div>
          <h2>{site.finalCta.headline}</h2>
          <p>{site.finalCta.body}</p>
        </div>
        <div className="actions">
          <WebCallControl buttonClassName="button-accent" />
          {actionLink(site.finalCta.secondaryCtaLabel, tenant.links.consultation, "button button-dark-outline")}
        </div>
      </section>

      <footer>
        <span>{tenant.branding.logoText}</span>
        <a href={`mailto:${tenant.contact.email}`}>{tenant.contact.email}</a>
        <span>{tenant.contact.address}</span>
      </footer>
    </main>
    </WebCallProvider>
  );
}
