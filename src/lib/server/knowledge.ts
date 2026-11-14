import type { Safety } from "../types";

export interface KnowledgeEntry {
  title: string;
  summary: string;
  quit?: string;
  safety?: Safety;
}

const RELAUNCH = "macOS starts it again the next time it's needed.";

/** Keyed by executable name. Covers the processes people most often ask about. */
const BY_NAME: Record<string, KnowledgeEntry> = {
  kernel_task: {
    title: "macOS kernel",
    summary:
      "The heart of macOS. It schedules every other process, manages memory and drivers, and deliberately uses CPU to cool the Mac down when it runs hot (thermal throttling).",
    quit: "It can't be ended. High CPU here usually means the Mac is managing heat or a busy driver.",
    safety: "critical",
  },
  launchd: {
    title: "Service launcher",
    summary:
      "The first process macOS starts. It launches and supervises every daemon, agent and app, and restarts services when they exit.",
    quit: "Ending it would immediately crash the system.",
    safety: "critical",
  },
  WindowServer: {
    title: "Window and display server",
    summary:
      "Draws everything on screen: windows, the menu bar, animations and every display. Its CPU and GPU use rise with the number of windows, displays and transparency effects.",
    quit: "Ending it logs you out instantly and closes every app without saving.",
    safety: "critical",
  },
  loginwindow: {
    title: "Login session",
    summary: "Owns your logged-in session: login, lock screen, logout and Force Quit.",
    quit: "Ending it logs you out immediately.",
    safety: "critical",
  },
  logd: {
    title: "Unified logging",
    summary: "Collects log messages from every process into the system log you can read in Console.",
    safety: "critical",
  },
  opendirectoryd: {
    title: "Directory services",
    summary: "Answers questions about user accounts, groups and passwords for the whole system.",
    safety: "critical",
  },
  securityd: {
    title: "Security server",
    summary: "Handles keychain access, certificates and cryptographic operations.",
    safety: "critical",
  },
  configd: {
    title: "System configuration",
    summary: "Tracks network settings, the host name and power state, and tells other processes when they change.",
    safety: "critical",
  },
  notifyd: {
    title: "Notification hub",
    summary: "Low-level messaging that lets system processes notify each other about events.",
    safety: "critical",
  },
  powerd: {
    title: "Power management",
    summary: "Decides when the Mac sleeps, wakes and dims, and tracks battery and power assertions.",
    safety: "critical",
  },
  UserEventAgent: {
    title: "System event agent",
    summary: "Loads small plug-ins that react to system events such as devices connecting or the network changing.",
    safety: "caution",
  },
  coreservicesd: {
    title: "Core Services",
    summary: "Manages file type associations and Launch Services, which decide which app opens which file.",
    safety: "critical",
  },
  mds: {
    title: "Spotlight server",
    summary: "The Spotlight metadata server. It keeps the search index up to date.",
    quit: RELAUNCH + " High CPU usually means it's indexing new or changed files.",
    safety: "relaunches",
  },
  mds_stores: {
    title: "Spotlight index store",
    summary: "Writes Spotlight's search index to disk. Busy after big file changes, updates or plugging in drives.",
    quit: RELAUNCH,
    safety: "relaunches",
  },
  mdworker_shared: {
    title: "Spotlight importer",
    summary: "Short-lived workers that read files and extract text and metadata for Spotlight search.",
    quit: RELAUNCH,
    safety: "relaunches",
  },
  mdworker: {
    title: "Spotlight importer",
    summary: "Reads files and extracts metadata for Spotlight search.",
    quit: RELAUNCH,
    safety: "relaunches",
  },
  mdsync: {
    title: "Spotlight sync",
    summary: "Keeps Spotlight's index in sync with external and network volumes.",
    safety: "relaunches",
  },
  corespotlightd: {
    title: "Core Spotlight",
    summary: "Indexes content that apps donate to Spotlight, such as messages, notes and mail.",
    safety: "relaunches",
  },
  Spotlight: {
    title: "Spotlight",
    summary: "The Spotlight search bar you open with Command-Space.",
    safety: "relaunches",
  },
  fseventsd: {
    title: "File system events",
    summary: "Records file changes so Spotlight, Time Machine and apps can tell what changed without rescanning the disk.",
    safety: "critical",
  },
  coreaudiod: {
    title: "Core Audio",
    summary: "Mixes and routes all sound on the Mac to speakers, headphones and audio devices.",
    quit: "Sound stops for a moment, then macOS restarts it. Ending it is a common fix for crackling or missing audio.",
    safety: "relaunches",
  },
  bluetoothd: {
    title: "Bluetooth",
    summary: "Manages Bluetooth connections to keyboards, mice, headphones and other devices.",
    quit: "Bluetooth devices disconnect briefly while it restarts.",
    safety: "relaunches",
  },
  airportd: {
    title: "Wi-Fi",
    summary: "Scans for and maintains Wi-Fi connections.",
    safety: "caution",
  },
  mDNSResponder: {
    title: "DNS and Bonjour",
    summary: "Resolves domain names for every app and discovers printers and devices on your local network (Bonjour).",
    quit: "Internet name lookups fail for a moment while it restarts. Ending it flushes the DNS cache.",
    safety: "caution",
  },
  cloudd: {
    title: "iCloud sync",
    summary: "Syncs data between apps and iCloud (CloudKit). Busy after you sign in or change lots of synced data.",
    quit: RELAUNCH,
    safety: "relaunches",
  },
  bird: {
    title: "iCloud Drive",
    summary: "Syncs files in iCloud Drive and Desktop & Documents folders.",
    quit: RELAUNCH + " Busy while large uploads or downloads are running.",
    safety: "relaunches",
  },
  fileproviderd: {
    title: "File Provider",
    summary: "Connects cloud storage (iCloud Drive, Dropbox, Google Drive, OneDrive) to Finder.",
    safety: "relaunches",
  },
  photoanalysisd: {
    title: "Photos analysis",
    summary: "Analyses your photo library for faces, scenes and Memories. It works mostly when the Mac is idle.",
    quit: RELAUNCH,
    safety: "relaunches",
  },
  photolibraryd: {
    title: "Photos library",
    summary: "Gives apps access to your Photos library and keeps it in sync with iCloud Photos.",
    safety: "relaunches",
  },
  mediaanalysisd: {
    title: "Media analysis",
    summary: "Runs on-device machine learning over photos and videos for search, Live Text and Visual Look Up.",
    safety: "relaunches",
  },
  backupd: {
    title: "Time Machine",
    summary: "Runs Time Machine backups.",
    quit: "The current backup stops and resumes later.",
    safety: "relaunches",
  },
  softwareupdated: {
    title: "Software Update",
    summary: "Checks for, downloads and installs macOS updates.",
    safety: "relaunches",
  },
  trustd: {
    title: "Certificate trust",
    summary: "Checks certificates for secure websites, apps and email.",
    safety: "relaunches",
  },
  syspolicyd: {
    title: "Gatekeeper",
    summary: "Checks that apps you open are signed and notarized, and blocks known malware.",
    safety: "caution",
  },
  XprotectService: {
    title: "XProtect",
    summary: "Apple's built-in malware scanner.",
    safety: "relaunches",
  },
  XProtect: {
    title: "XProtect",
    summary: "Apple's built-in malware scanner. It scans apps and files against known malware signatures.",
    safety: "relaunches",
  },
  amfid: {
    title: "Code signature checker",
    summary: "Verifies code signatures before programs are allowed to run.",
    safety: "critical",
  },
  Dock: {
    title: "Dock",
    summary: "Draws the Dock, Mission Control, Launchpad and desktop spaces.",
    quit: "The Dock disappears for a second and comes back. A common fix for a stuck Dock or Mission Control.",
    safety: "relaunches",
  },
  Finder: {
    title: "Finder",
    summary: "The file manager and the desktop icons.",
    quit: "Finder windows close and Finder reopens automatically.",
    safety: "relaunches",
  },
  SystemUIServer: {
    title: "Menu bar extras",
    summary: "Draws some of the system's menu bar items.",
    quit: "The menu bar items flicker and come back.",
    safety: "relaunches",
  },
  ControlCenter: {
    title: "Control Center",
    summary: "The menu bar clock, Control Center and most system menu bar icons.",
    quit: "Menu bar icons disappear briefly while it restarts.",
    safety: "relaunches",
  },
  NotificationCenter: {
    title: "Notification Center",
    summary: "Shows notification banners, widgets and the Notification Center panel.",
    safety: "relaunches",
  },
  WallpaperAgent: {
    title: "Wallpaper",
    summary: "Draws the desktop wallpaper, including dynamic and animated wallpapers.",
    safety: "relaunches",
  },
  universalaccessd: {
    title: "Accessibility",
    summary: "Runs accessibility features such as zoom, VoiceOver support and display filters.",
    safety: "relaunches",
  },
  sharingd: {
    title: "Sharing",
    summary: "Powers AirDrop, Handoff, Universal Clipboard and Continuity.",
    safety: "relaunches",
  },
  rapportd: {
    title: "Device link",
    summary: "Lets your Apple devices discover and talk to each other for Continuity features.",
    safety: "relaunches",
  },
  identityservicesd: {
    title: "Apple ID messaging",
    summary: "Registers your devices with Apple for iMessage, FaceTime and Continuity.",
    safety: "relaunches",
  },
  apsd: {
    title: "Push notifications",
    summary: "Keeps the connection to Apple's push notification service so apps receive notifications.",
    safety: "relaunches",
  },
  nsurlsessiond: {
    title: "Background downloads",
    summary: "Downloads and uploads files in the background for apps and macOS, such as updates and iCloud files.",
    quit: "Background transfers pause and resume when it relaunches.",
    safety: "relaunches",
  },
  locationd: {
    title: "Location Services",
    summary: "Works out the Mac's location for apps you've allowed to use it.",
    safety: "relaunches",
  },
  tccd: {
    title: "Privacy permissions",
    summary: "Enforces privacy permissions such as camera, microphone, screen recording and file access.",
    safety: "caution",
  },
  secd: {
    title: "Keychain sync",
    summary: "Manages your keychain and keeps passwords in sync with iCloud Keychain.",
    safety: "relaunches",
  },
  accountsd: {
    title: "Accounts",
    summary: "Stores the internet accounts (iCloud, Google, Exchange) that apps use.",
    safety: "relaunches",
  },
  cfprefsd: {
    title: "Preferences",
    summary: "Reads and writes app and system settings (preference files).",
    quit: "Settings changed in the last moment might not be saved.",
    safety: "caution",
  },
  distnoted: {
    title: "Distributed notifications",
    summary: "Passes notifications between apps in your session.",
    safety: "caution",
  },
  lsd: {
    title: "Launch Services",
    summary: "Keeps track of installed apps and which app opens which kind of file.",
    safety: "relaunches",
  },
  usernoted: {
    title: "User notifications",
    summary: "Delivers app notifications to Notification Center.",
    safety: "relaunches",
  },
  hidd: {
    title: "Input devices",
    summary: "Handles keyboards, trackpads and mice.",
    quit: "Input stops working until it relaunches.",
    safety: "critical",
  },
  "com.apple.WebKit.WebContent": {
    title: "Web page content",
    summary: "One web page or tab being rendered by Safari or another app that shows web content. Each tab gets its own process.",
    quit: "The page it was showing reloads or shows an error. Your other tabs keep working.",
    safety: "safe",
  },
  "com.apple.WebKit.Networking": {
    title: "WebKit networking",
    summary: "Downloads web content for Safari and apps that embed web views.",
    safety: "safe",
  },
  "com.apple.WebKit.GPU": {
    title: "WebKit graphics",
    summary: "Draws web content and video on the GPU for Safari and web views.",
    safety: "safe",
  },
  "Google Chrome Helper (Renderer)": {
    title: "Chrome tab",
    summary: "Renders one or more Chrome tabs or extensions. Chrome gives each site its own process.",
    quit: "The tab it was rendering shows the 'Aw, Snap!' page.",
    safety: "safe",
  },
  "Google Chrome Helper (GPU)": {
    title: "Chrome GPU",
    summary: "Chrome's graphics process. It draws pages and video for every tab.",
    safety: "safe",
  },
  "Google Chrome Helper": {
    title: "Chrome helper",
    summary: "A Chrome utility process for networking, audio or storage.",
    safety: "safe",
  },
  node: {
    title: "Node.js",
    summary: "A JavaScript runtime. Usually a dev server, a build tool or an editor extension that you or your editor started.",
    quit: "Whatever script it's running stops. Dev servers need to be started again.",
    safety: "safe",
  },
  bun: {
    title: "Bun",
    summary: "A fast JavaScript runtime and package manager, often a dev server or script.",
    safety: "safe",
  },
  deno: { title: "Deno", summary: "A JavaScript and TypeScript runtime running a script.", safety: "safe" },
  python3: { title: "Python", summary: "A Python program or script.", safety: "safe" },
  python: { title: "Python", summary: "A Python program or script.", safety: "safe" },
  ruby: { title: "Ruby", summary: "A Ruby program or script.", safety: "safe" },
  java: { title: "Java", summary: "A Java program, for example a build tool, IDE or server.", safety: "safe" },
  zsh: { title: "Zsh shell", summary: "A terminal shell session, the default command line on macOS.", safety: "safe" },
  bash: { title: "Bash shell", summary: "A terminal shell session.", safety: "safe" },
  fish: { title: "Fish shell", summary: "A terminal shell session.", safety: "safe" },
  login: { title: "Terminal login", summary: "Starts the shell for a terminal window or tab.", safety: "safe" },
  ssh: { title: "SSH client", summary: "A secure shell connection to another computer.", safety: "safe" },
  "ssh-agent": { title: "SSH agent", summary: "Holds your SSH keys in memory so you don't retype passphrases.", safety: "safe" },
  git: { title: "Git", summary: "The git version control tool running a command.", safety: "safe" },
  esbuild: { title: "esbuild", summary: "A JavaScript bundler, usually started by a dev server or build.", safety: "safe" },
  "com.docker.backend": {
    title: "Docker backend",
    summary: "Runs Docker Desktop's Linux VM and containers.",
    quit: "All running containers stop.",
    safety: "safe",
  },
  "com.apple.Virtualization.VirtualMachine": {
    title: "Virtual machine",
    summary: "A virtual machine running through Apple's Virtualization framework (Docker, UTM, OrbStack and others use it).",
    quit: "The virtual machine and everything in it stops immediately.",
    safety: "caution",
  },
  sysmond: {
    title: "System monitor",
    summary: "Collects process statistics for Activity Monitor and similar tools.",
    safety: "relaunches",
  },
  thermalmonitord: { title: "Thermal monitor", summary: "Watches temperatures and asks the system to slow down when it gets hot.", safety: "critical" },
  diskarbitrationd: { title: "Disk arbitration", summary: "Mounts and unmounts disks and volumes.", safety: "critical" },
  kextd: { title: "Kernel extensions", summary: "Loads kernel extensions (drivers).", safety: "critical" },
  kernelmanagerd: { title: "Kernel extensions", summary: "Loads and manages kernel and driver extensions.", safety: "critical" },
  runningboardd: { title: "Process manager", summary: "Decides which apps and processes get CPU and memory, and which are suspended.", safety: "critical" },
  watchdogd: { title: "Watchdog", summary: "Restarts the Mac if critical system processes stop responding.", safety: "critical" },
  symptomsd: { title: "Network diagnostics", summary: "Monitors network quality and per-app data usage.", safety: "relaunches" },
  nehelper: { title: "Network extensions", summary: "Helps VPN and content filter extensions work.", safety: "relaunches" },
  nesessionmanager: { title: "VPN sessions", summary: "Manages VPN and network extension sessions.", safety: "caution" },
  remoted: { title: "Remote devices", summary: "Talks to connected devices like iPhones and the Touch Bar.", safety: "relaunches" },
  sandboxd: { title: "Sandbox", summary: "Enforces app sandbox rules and logs violations.", safety: "caution" },
  containermanagerd: { title: "App containers", summary: "Creates and manages sandboxed app data containers.", safety: "caution" },
  suggestd: { title: "Siri Suggestions", summary: "Learns from mail, messages and apps to offer suggestions in Spotlight and Siri.", safety: "relaunches" },
  siriactionsd: { title: "Siri actions", summary: "Runs Shortcuts and Siri actions.", safety: "relaunches" },
  assistantd: { title: "Siri", summary: "Handles Siri requests.", safety: "relaunches" },
  knowledge_agent: { title: "On-device knowledge", summary: "Builds an on-device record of app usage for suggestions and Screen Time.", safety: "relaunches" },
  ScreenTimeAgent: { title: "Screen Time", summary: "Tracks app and website usage for Screen Time.", safety: "relaunches" },
  AMPDevicesAgent: { title: "Device sync", summary: "Syncs iPhones and iPads with the Mac in Finder.", safety: "relaunches" },
  ReportCrash: { title: "Crash reporter", summary: "Writes crash reports when an app crashes.", safety: "relaunches" },
  spindump: { title: "Hang reporter", summary: "Samples processes that hang so a report can be created.", safety: "relaunches" },
  colorsync: { title: "Color management", summary: "Matches colors across displays and printers.", safety: "relaunches" },
  gamecontrollerd: { title: "Game controllers", summary: "Manages game controllers.", safety: "relaunches" },
  audiomxd: { title: "Audio routing", summary: "Manages audio sessions for apps.", safety: "relaunches" },
  corebrightnessd: { title: "Display brightness", summary: "Controls display brightness, True Tone and Night Shift.", safety: "relaunches" },
  bootinstalld: { title: "Boot installer", summary: "Installs firmware and boot components during updates.", safety: "caution" },
  "screencaptureui": { title: "Screenshot UI", summary: "Shows the screenshot and screen recording toolbar.", safety: "safe" },
  Siri: { title: "Siri", summary: "The Siri interface.", safety: "relaunches" },
  TextInputMenuAgent: { title: "Input menu", summary: "The keyboard input menu in the menu bar.", safety: "relaunches" },
  talagent: { title: "Window restoration", summary: "Restores app windows after restart and manages automatic termination.", safety: "relaunches" },
  pboard: { title: "Clipboard", summary: "Holds the clipboard (copy and paste).", quit: "You lose what's currently on the clipboard.", safety: "relaunches" },
  sharedfilelistd: { title: "Recent items", summary: "Keeps recent files, favorites and login item lists.", safety: "relaunches" },
  iconservicesagent: { title: "Icon cache", summary: "Draws and caches app and file icons.", safety: "relaunches" },
  QuickLookUIService: { title: "Quick Look", summary: "Shows Quick Look previews when you press Space in Finder.", safety: "safe" },
  CoreLocationAgent: { title: "Location prompts", summary: "Shows Location Services permission prompts.", safety: "relaunches" },
  chronod: { title: "Widgets", summary: "Keeps desktop and Notification Center widgets up to date.", safety: "relaunches" },
  WindowManager: { title: "Stage Manager", summary: "Runs Stage Manager and window tiling.", safety: "relaunches" },
  "Activity Monitor": { title: "Activity Monitor", summary: "Apple's built-in process monitor.", safety: "safe" },
  Electron: { title: "Electron app", summary: "An app built with Electron, which bundles Chromium and Node.js.", safety: "safe" },
};

const BY_BUNDLE: Record<string, KnowledgeEntry> = {
  "com.apple.Safari": { title: "Safari", summary: "Apple's web browser. Each tab runs in its own WebContent process.", safety: "safe" },
  "com.google.Chrome": {
    title: "Google Chrome",
    summary: "Google's web browser. Chrome runs separate processes per site, extension and GPU, so it often shows many processes.",
    safety: "safe",
  },
  "com.microsoft.VSCode": { title: "Visual Studio Code", summary: "Microsoft's code editor, built on Electron.", safety: "safe" },
  "com.todesktop.230313mzl4w4u92": { title: "Cursor", summary: "An AI code editor built on VS Code. Terminals and language servers run as its children.", safety: "safe" },
  "com.apple.Terminal": { title: "Terminal", summary: "macOS's command-line app. Shells and commands you run appear under it.", safety: "safe" },
  "com.googlecode.iterm2": { title: "iTerm2", summary: "A popular terminal app. Shells and commands you run appear under it.", safety: "safe" },
  "com.docker.docker": { title: "Docker Desktop", summary: "Runs Docker containers in a lightweight Linux VM.", safety: "safe" },
  "com.spotify.client": { title: "Spotify", summary: "Spotify's music app.", safety: "safe" },
  "com.tinyspeck.slackmacgap": { title: "Slack", summary: "Slack's desktop app, built on Electron.", safety: "safe" },
  "com.hnc.Discord": { title: "Discord", summary: "Discord's desktop app, built on Electron.", safety: "safe" },
  "com.apple.finder": BY_NAME.Finder,
  "com.apple.dock": BY_NAME.Dock,
  "com.apple.controlcenter": BY_NAME.ControlCenter,
};

const PATTERNS: Array<{ test: RegExp; entry: KnowledgeEntry }> = [
  {
    test: /Helper \(Renderer\)$/,
    entry: {
      title: "Renderer helper",
      summary: "Renders web content (a tab, window or extension) for a Chromium or Electron based app.",
      quit: "The part of the app it was drawing goes blank or reloads.",
      safety: "safe",
    },
  },
  {
    test: /Helper \(GPU\)$/,
    entry: { title: "GPU helper", summary: "Draws the app's interface and video on the GPU for a Chromium or Electron based app.", safety: "safe" },
  },
  {
    test: /Helper \(Plugin\)$/,
    entry: { title: "Plugin helper", summary: "Runs plugins or extensions for a Chromium or Electron based app.", safety: "safe" },
  },
  {
    test: /Helper$/,
    entry: { title: "App helper", summary: "A utility process an app starts for networking, storage, audio or background work.", safety: "safe" },
  },
  {
    test: /^com\.apple\.WebKit\./,
    entry: { title: "WebKit process", summary: "Part of the WebKit engine that Safari and many apps use to show web content.", safety: "safe" },
  },
  {
    test: /^mdworker/,
    entry: BY_NAME.mdworker_shared,
  },
  {
    test: /\.xpc$|XPCService|Service$/,
    entry: {
      title: "XPC service",
      summary: "A small, sandboxed service that an app or macOS starts on demand to do one job, then exits when idle.",
      quit: RELAUNCH,
      safety: "relaunches",
    },
  },
  {
    test: /Agent$/,
    entry: { title: "Background agent", summary: "A background agent running in your login session.", safety: "relaunches" },
  },
];

export function lookupKnowledge(name: string, bundleId?: string): KnowledgeEntry | undefined {
  if (bundleId && BY_BUNDLE[bundleId]) return BY_BUNDLE[bundleId];
  if (BY_NAME[name]) return BY_NAME[name];
  return undefined;
}

export function lookupPattern(name: string): KnowledgeEntry | undefined {
  return PATTERNS.find((p) => p.test.test(name))?.entry;
}

/** Names whose loss takes the session or the machine down. */
export const CRITICAL_NAMES = new Set(
  Object.entries(BY_NAME)
    .filter(([, e]) => e.safety === "critical")
    .map(([name]) => name),
);

export const KNOWN_SAFETY = (name: string): Safety | undefined => BY_NAME[name]?.safety;
