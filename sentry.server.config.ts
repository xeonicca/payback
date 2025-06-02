import * as Sentry from "@sentry/nuxt";
 
Sentry.init({
  dsn: "https://d814086c1e868f220487794155954c73@o4509431702290432.ingest.us.sentry.io/4509431704322048",

  // We recommend adjusting this value in production, or using tracesSampler
  // for finer control
  tracesSampleRate: 1.0,
  
  // Setting this option to true will print useful information to the console while you're setting up Sentry.
  debug: false,
});
