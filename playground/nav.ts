import "./nav.css";

interface NavLink {
  /** What the page answers, shown while it is open. */
  answers: string;
  href: string;
  label: string;
}

/** Every page of the playground, in the order of the strip. */
const LINKS: NavLink[] = [
  {
    answers: "Use and test the library: effects, read method, live metrics.",
    href: "/",
    label: "Playground",
  },
  {
    answers: "Which sources and browsers give colours at all?",
    href: "/compat.html",
    label: "Compat",
  },
  {
    answers: "Which CSS rendering of the glow is cheapest?",
    href: "/css-bench.html",
    label: "CSS bench",
  },
  {
    answers: "Write each sample at once, or grouped per frame?",
    href: "/raf-bench.html",
    label: "rAF",
  },
  {
    answers: "Does the full pipeline hold under load?",
    href: "/load-bench.html",
    label: "Load",
  },
  {
    answers: "What else can the colours of a video drive?",
    href: "/labs/",
    label: "Labs",
  },
];

const INDEX_SUFFIX = /index\.html$/u;

/** The link of the page at `path` (labs has sub-pages, `/index.html` is `/`). */
function currentLink(path: string): NavLink | undefined {
  if (path.startsWith("/labs/")) {
    return LINKS.find((link) => link.href === "/labs/");
  }
  const page = path.replace(INDEX_SUFFIX, "");
  return LINKS.find((link) => link.href === page);
}

/** Puts the shared strip at the top of the page; the page's own layout is untouched below it. */
function mountNav(): void {
  const current = currentLink(location.pathname);
  const nav = document.createElement("nav");
  nav.className = "glow-nav";
  nav.setAttribute("aria-label", "Playground pages");
  for (const link of LINKS) {
    const anchor = document.createElement("a");
    anchor.href = link.href;
    anchor.textContent = link.label;
    if (link === current) {
      anchor.setAttribute("aria-current", "page");
    }
    nav.append(anchor);
  }
  if (current) {
    const answers = document.createElement("span");
    answers.className = "glow-nav-answers";
    answers.textContent = current.answers;
    nav.append(answers);
  }
  document.body.prepend(nav);
}

mountNav();
