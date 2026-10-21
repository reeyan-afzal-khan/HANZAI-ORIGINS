/* native.js — the bits that only exist inside the Android shell.
 *
 * Loaded in both builds and does nothing in a browser: the page is the same
 * page everywhere, and the shell only adds to it. Kept out of boot.js so the
 * web build is not carrying dead conditionals through its hot path. */
(function(){
  const cap = window.Capacitor;
  if(!cap || !cap.Plugins) return;
  const PL = cap.Plugins;

  /* Back must walk the app's own state first. Without this the system gesture
     closes the app mid-session, which loses nothing on disk but feels like a
     crash. A dialog closes, then a running session ends, then a view that is
     not Home goes Home — and only then does back mean leave. */
  if(PL.App && PL.App.addListener){
    PL.App.addListener("backButton", () => {
      const detail = document.getElementById("detail");
      const help = document.getElementById("help");
      const writing = document.getElementById("writing");
      const gate = document.getElementById("talk-gate");
      const shut = d => typeof closeDialog === "function" ? closeDialog(d) : d.close();
      /* The consent check: back is "stay lighter". */
      if(gate && gate.open && typeof answerTalkGate === "function"){ answerTalkGate("no"); return; }
      if(writing && writing.open){ shut(writing); return; }
      if(help && help.open){ shut(help); return; }
      if(detail && detail.open){ shut(detail); return; }
      /* In the reader: a word card closes, then the settings drawer, then
         the book goes back to the shelf — the same steps a reader would take
         by hand — before the view itself is left. */
      if(S.view === "read" && typeof R !== "undefined" && R.book){
        if(typeof selectionActive === "function" && selectionActive()){ clearSelection(); return; }
        if(R.sheet){ closeGloss(); return; }
        const panel = document.getElementById("rd-panel");
        if(panel && !panel.classList.contains("hidden") && typeof setReaderPanel === "function"){ setReaderPanel(false); return; }
        if(typeof closeBookGently === "function") closeBookGently(); else closeBook();
        return;
      }
      /* A conversation: its word card closes first; then the run ends with
         its recap, and is in the record either way. */
      if(S.view === "talk" && typeof TK !== "undefined" && TK.run){
        if(TK.sheet){ closeTalkGloss(); return; }
        talkFinish(true); return;
      }
      if(S.view !== "home"){ show("home"); return; }
      PL.App.exitApp();
    });
  }

  /* The page paints its own background under the status bar, so the bar has to
     match whichever palette is live — a light theme under a bar still set to
     light-on-black is the one place the seam shows. Exposed as a hook the
     theme code calls, rather than read from there, so the web build carries no
     Capacitor references. */
  if(PL.StatusBar && PL.StatusBar.setStyle){
    window.hskkerNativeTheme = function(skin){
      // Capacitor names the style after the theme, not the text: DARK is the
      // light-text-on-a-dark-bar one.
      PL.StatusBar.setStyle({style: skin.dark ? "DARK" : "LIGHT"}).catch(()=>{});
      PL.StatusBar.setBackgroundColor({color: skin.bg}).catch(()=>{});
    };
    /* Full screen in the reader: the status bar goes with the rest of the
       chrome, and comes back with it. */
    if(PL.StatusBar.hide && PL.StatusBar.show){
      window.hskkerNativeImmersive = function(on){
        (on ? PL.StatusBar.hide() : PL.StatusBar.show()).catch(()=>{});
      };
    }
    /* boot.js has already painted by the time this file runs, so catch up with
       whatever it landed on instead of assuming the default. */
    window.hskkerNativeTheme(typeof skinOf === "function"
      ? skinOf(document.documentElement.dataset.skin)
      : {dark: true, bg: "#1D2021"});
  }

  /* While a book is open, the page corners at the screen's edges are kept
     from the system's back gesture (see EdgeGuardPlugin.java). The reader
     marks itself on <body>; the shell follows that mark. */
  const EG = typeof cap.registerPlugin === "function" ? cap.registerPlugin("EdgeGuard") : PL.EdgeGuard;
  if(EG && EG.set){
    let guarded = null;
    const follow = () => {
      const want = document.body.classList.contains("reading");
      if(want === guarded) return;
      guarded = want;
      EG.set({on: want}).catch(()=>{});
    };
    new MutationObserver(follow).observe(document.body, {attributes: true, attributeFilter: ["class"]});
    follow();
  }

  /* The reader's offline translator, installed on request into the app's own
     storage (see OfflineTranslatorPlugin.java) rather than carried in the
     APK. The page passes the list of files and reads them back through the
     bridge's file address. */
  const OT = typeof cap.registerPlugin === "function" ? cap.registerPlugin("OfflineTranslator") : PL.OfflineTranslator;
  if(OT && typeof cap.convertFileSrc === "function"){
    window.hskkerNative = Object.assign(window.hskkerNative || {}, {
      translator: {
        status: files => OT.status({files}),
        install: async (files, onProgress) => {
          const handle = await OT.addListener("progress", e => { if(onProgress) onProgress(e.done, e.total); });
          try{ return await OT.install({files}); }
          finally{ handle.remove(); }
        },
        remove: () => OT.remove(),
        url: (base, path) => cap.convertFileSrc(`${base}/${path}`),
      },
    });
  }

  if(PL.SplashScreen && PL.SplashScreen.hide) PL.SplashScreen.hide().catch(()=>{});
})();
