# SanctuaryFlow User Guide

This guide is for the people who prepare and run the screens during worship. No technical knowledge is needed.

## 1. Installing

1. Run `SanctuaryFlow_<version>_x64-setup.exe` and follow the steps. It installs for the current Windows user and does not need administrator rights.
2. SanctuaryFlow uses Microsoft Edge WebView2, which is built into Windows 11 and most Windows 10 computers. If it is missing, the installer adds it (this needs an internet connection once). For a computer that will never be online, install the WebView2 runtime from Microsoft's *Evergreen Standalone Installer* first.
3. Start SanctuaryFlow from the Start menu.

Everything you add is stored on this computer in the **library folder** (Settings → Library shows where). The internet is only used for optional cloud synchronization and for downloading Bible translations.

## 2. First-time setup

**Welcome:** the first time SanctuaryFlow starts, a short welcome asks **your name** (and, if you like, your church's name), then walks through planning services, songs, the Bible and going live. **Skip** (top right) closes it at any point; **Back**, **Next**, the dots on the gold side, Enter and the arrow keys move through it. Your name is used to greet you (*Good Afternoon, Grace*) and on the Home page; change it in Settings → General, where **Show the welcome tour again** brings the walkthrough back.

**Home** is laid out like your church's page: a cover of your own pictures from the Media Library (brushed gold until you add some), the logo, a greeting with your name and the main actions (*Start presentation*, *Plan Sunday*, the service you opened last). Below:

- **Verse for today** — the same verse as the greeting, from your Bible.
- **Coming up** — the next services; ▶ opens one on the Live page.
- **Recent Scripture** — passages you presented, one click away.
- **Songs, Services, Times presented, Media files** — headline numbers; the small lines show the last six months.
- **Services by month** — four months back, this month and next (next month in a lighter gold: services planned ahead).
- **Most presented songs**, **What your services include** (songs, Scripture, announcements… and their share) and **Recently presented**.

Every number comes from the library on this computer; point at a bar or a month to see its value.

When the library is empty, Home also shows a checklist:

1. **Church name** — Settings → General. It is shown on the holding screen when no logo is set.
2. **Bible translation** — Bible Library → Translations (see section 4).
3. **Songs** — Song Library → New, or import a song list (section 3).
4. **First service** — Home → *Plan Sunday*.
5. **First backup** — Backup & Restore → *Back up now*. Use a USB drive if you can.

**Greeting:** when you open SanctuaryFlow it greets you by name with a Bible verse: *Good Morning* (until 11:59 am), *Good Afternoon* (12 pm–5:59 pm) or *Good Evening* (6 pm–11:59 pm). It greets once in each part of the day: open it at 7 am and again at 11 am, and only the 7 am opening is greeted; open it again at 1 pm and you are greeted with *Good Afternoon*. The verse changes every day and is read from your default Bible translation, so a translation must be installed (section 4). Turn it off in Settings → General.

**Song lyrics** use **Metallic Gold** unless you choose otherwise: white Arial with a soft shadow on brushed metallic gold. A new song shows it as soon as it is saved. (A library whose song default was another built-in theme moves to Metallic Gold once; one that chose a theme of its own keeps it.) To use another look, open it in Presentation Themes and press *Default for: Songs*.

**Built-in themes:** besides the plain ones, three more gold designs come ready to use: **Golden Hour** for song lyrics (warm gold light behind the words), **Royal Gold** for announcements (royal navy with a fine gold frame) and **Gold Scripture** for Bible passages (warm dark background, gold frame, the reference in gold at the top). Drag one onto an item on the Live page, or choose them as defaults in Settings → Presentation. In the theme editor, *Style* (for black or colour backgrounds) gives any theme these backdrops, and *Metallic gold*.

**Interface theme:** SanctuaryFlow opens in *Light* (white and gold). Switch between **Light** and **Dark** (for dim worship spaces) with the buttons at the top of every page, next to the search box; both use the same gold; *High contrast* is in Settings → General. This only changes the operator console; the projector always uses the presentation themes.

Connect the projector and set it as the **output display** in Settings → Presentation (or leave it on *Automatic*, which uses the screen that is not your main screen).

## 3. Songs

- **Artists:** the Song Library opens on **Artists**: every artist (or worship leader) with a cover picture and their songs. Click an artist to see their songs; **Add cover picture…** sets the cover (*Import file…* takes one straight from your computer). Artists and songs without a cover show the gold album picture. **Default cover…** above the artists replaces it with a picture of your own; **Use the gold album** brings it back. Artists are matched however their name is typed ("Hillsong Worship" and "hillsong  worship" are the same), and songs without an artist are under *No artist*. The **Songs**, **Favorites** and **Archived** tabs list songs A–Z; the search box finds songs, artists and lyrics.
- **Editing a song** (*Edit*, then *Save*) also updates it where it is being presented: the Live page and the output show the new words straight away, keeping your place in the song.
- **New song:** **New song** (or *New song by …* on an artist's page). A song has just a **title**, an **artist** (start typing to pick one you already have, so the song joins that artist) and its **lyrics**. Details that imported songs may carry, such as key or copyright, are kept but not shown.
- **Music:** open a song and use **Add music (MP3)…** in its *Music* box (MP3, M4A, WAV and other common audio files; *Import file…* takes one straight from your computer). **Album cover…** sets the cover; without one, the artist's cover is used, then the gold album picture (also on the output's vinyl). The player has play/pause, previous/next song (from the list or artist you opened it from), position, volume and speed, and plays on into the next song when one ends. Music stays on this computer: it is never uploaded to cloud synchronization.
- **Lyrics that follow the music:** **Sync lyrics…** opens the timing editor. Play the song and press **Tap** (or T / Enter) as each line starts; Space plays and pauses, **End line here** (E) leaves a gap before an instrumental part. Times can also be typed, lines split, added, moved or deleted, and **Preview** shows what the congregation will see. **Save timing** keeps it. If you change the lyrics later, **Rebuild from lyrics** updates the lines and keeps the times of lines that are still there. Once timed, the song's *Music* box highlights the line being sung.
- **Sections:** each section has a type (Verse, Chorus, Bridge…) and a name. Drag the handle to reorder.
- **Slide breaks:** leave a blank line inside a section to start a new slide. Sections longer than the line limit (Settings → Presentation, default 4 lines) are split evenly.
- **Line by line:** the selector beside each section's name sets how many lines that section shows per slide. Choose *Line by line* (for example on the chorus) to present it one line at a time; *Default* uses the Settings → Presentation limit. The slide preview on the right updates as you change it.
- **Paste a whole song:** *Paste whole song* understands headers like `[Verse 1]`, `Chorus:` or `Koro`.
- **Presentation order:** use the ↻ button on a section to build an order with repeats (Verse 1, Chorus, Verse 2, Chorus, Bridge, Chorus).
- **Search:** type any words from the title, artist, tags or lyrics. Accents are ignored (*senor* finds *Señor*).
- **Import/export:** Song Library → import/export icons, or Import & Export. Duplicates are detected and you choose to skip, add or replace each one. Only import songs your church is licensed to use.
- **Archive** hides a song without deleting it.

## 4. Bible translations

**Install:** Bible Library → **Translations**.

- **Download from eBible.org** lists translations whose copyright holders allow redistribution, such as the World English Bible (public domain). Choose one, review the report, and import.
- **Import a file** accepts USFM (single file, folder or zip), USX, OSIS XML, SanctuaryFlow JSON and CSV. See [FILE_FORMATS.md](FILE_FORMATS.md).

Every import shows a **validation report** before anything is stored:

- *Complete* — all 66 books and 1,189 chapters are present.
- *Incomplete* — books or chapters are missing, or the chapter structure differs (a different versification). It can still be used; missing passages show a clear message.
- *Has errors* — for example the same verse appears twice with different text. Fix the file first.

You must confirm that the license allows storing the translation on this computer. Books outside the 66-book catalog (for example deuterocanonical books) and empty verses are listed in the report and require your confirmation; they are never dropped silently. If an import fails, nothing is changed — a translation being replaced keeps its previous text.

**Read and present:** Bible Library → **Read & present**. Choose a book and chapter, or type a reference in *Go to* (`John 3:16`, `Ps 23`, `Romans 8:28-30`, `Gen 1:26-2:3`, `1 Cor 13`). Click a verse, then Shift+click another to select a range. Use **Present**, **Add to service**, copy, or the star for favorites. The side panel has offline text search, recent passages and favorites.

Settings → Presentation controls how Scripture is split into slides (verses kept together as many as fit, or one verse per slide) and whether paragraph marks (¶) are hidden.

## 5. Planning a service

Service Planner → **New service**: give it a title, date and time, and start empty, from a template, or by copying a previous service.

- The list shows each service with a calendar date, its time and how many items it has. **Edit details** (the pencil) changes its title, date, time, status and theme; click a service to plan its order.
- While planning, only the title and date are shown at the top. The pencil next to them opens the same details.
- Add items with the tiles under **Add to service**: Song, Scripture, Sermon slides, Announcement, Import / Canva, Custom slides, Image, Video, Heading, Blank. Hover a tile to see what it adds. Items are numbered in order, and headings divide the order into sections.
- **Sermon slides** asks for the sermon's PowerPoint or PDF, or a Canva link (the same choices as *Import / Canva*, below), and keeps the slides with your sermon slides. *Choose slides from the library…* picks sermon slides you already have.
- Drag items to reorder, or use the arrows. Select an item to change its title, theme, notes (only you see them) and settings, and to preview its slides.
- **Changes save automatically.** The indicator next to the title shows *Saved*; if saving ever fails it says so and offers a retry.
- **Import / Canva** brings in a finished presentation. Each slide or page of a file becomes a picture slide, so it looks exactly as designed. These pictures stay with their slides: they are not listed in the Media Library, and they are removed when you delete the slides.
  - **PowerPoint (.pptx, .ppt):** converted by Microsoft PowerPoint, which must be installed on this computer. Hidden slides are left out; speaker notes become slide notes that only you see.
  - **PDF:** works on every computer. Use it for **Canva** (Share → Download → *PDF Standard*), **Google Slides** (File → Download → *PDF document*), Keynote, or PowerPoint on a computer without PowerPoint.
  - **Pictures:** a .png or .jpg, or a .zip of pictures such as Canva's *PNG* download (used in file-name order).
  - **A Canva link:** in Canva choose **Share**, set access to **Anyone with the link**, copy the link and paste it under *From a Canva link*. The name fills in from Canva. Then choose how to show it:
    - **Every page as a slide** (recommended): press *Open … in Canva*; in Canva choose **Share → Download → File type: PDF Standard → Download**. SanctuaryFlow notices the new file in your Downloads folder and makes every page a slide, exactly like a PDF import: all pages show in the preview, Next moves through them, the output and its preview always show the same page, and it works offline. If the file isn't picked up, use *Choose the downloaded file…*. After changing the design in Canva, select the item and use **Update from Canva…** to bring the new pages in.
    - **Live from Canva:** shows the design itself, so changes in Canva appear by themselves; it needs the internet during the service. Enter its **number of pages** (Canva shows it at the bottom of the design, for example "1 / 14"): each page becomes a slide, and Next, Previous and the arrow keys turn Canva's pages on the output and its preview together, without touching the output with the mouse. Next stops on the last page. The page count can be changed later in the Service Planner or next to the item on the Live page. Canva's own page bar (progress line, "1 / 14", zoom and full-screen buttons) is kept off the output and its preview, so only the design shows. A live Canva item can also be changed to downloaded page slides with **Show every page…** above the slides.
      - **Page thumbnails:** the first time a live Canva item is selected on the Live page, SanctuaryFlow takes a picture of each page in a hidden, muted window (about 2–3 seconds a page; *Page pictures 5 / 34* shows the progress, **Stop** pauses it and **Continue** carries on). The pictures become the item's thumbnails and the Next preview; the output itself always shows Canva live. They are stored on this computer with the item and are not listed in the Media Library. After changing the design in Canva, press **Update pictures**. If Canva can't be reached, the reason is shown with **Try again**.
- Every item has its own icon on a tile in a shade of the interface's gold (announcements in its navy).
- **Save as template** keeps the order for future weeks. **Export** creates a file that includes the songs and slides used, for another computer.

## 6. Presenting

Open **Live Presentation**.

1. With no service open, the page lists your services (coming up first, then earlier ones). Click one to open it. Later, the service name at the top left opens a menu to switch services, see *All services* again, or plan a new one; **Edit service** opens it in the Service Planner.
2. Click **Go Live** (top right). The output opens full screen on the second display (choose another in Settings → Presentation → *Output display*); with only one screen connected it opens as a window for practice. While you are live the button glows gold and reads **Live**, and the dot next to *LIVE OUTPUT* blinks red. Click the button again (it says *Stop live*) to close the output.
3. Click an item on the left to see its slides, then click a slide to show it. While you are live, the red border and *LIVE* mark what is on screen and *NEXT* what comes next. Before you go live, the slide you choose is only highlighted in gold.
4. **Edit service** opens the service in the Service Planner; its **Back to Live Presentation** button brings you straight back.

**Lock output (prepare while you present):** while live, press **Lock output** under Previous / Next. The output stays on the item that is showing (the lineup and the preview show a lock), and nothing else reaches the screen by accident: passages and songs from Present now, slides of other items you click, and jumps are only *prepared*. Next / Previous, the Jump row of the locked item, Black, Clear and Logo still work. A gold bar above the slides offers **Show “…” now** to put the prepared slide on screen (this also unlocks), or **Unlock**. Stop, Stop live, or opening another service also unlock.

**Jump to a song part:** above a song's slides, the **Jump** row has a short button for each part, as singers name them: *V1* (Verse 1), *C* (Chorus), *PC* (Pre-Chorus), *B* (Bridge), *O* (Outro)… (point at one to see its full name). One click puts the first line of that part on the screen, wherever you are in the list; the part being shown is filled in gold. A part sung several times (a chorus) goes to its next time after the slide on screen.

**Slides:** the buttons above the slides switch between **grid view** (pictures) and **list view**: the words only, grouped by song part ("Verse 1", "Chorus"…), where clicking any line shows its slide. Pictures and videos keep a small preview in the list. Slide labels are coloured by song part in shades of the interface's gold: verse gold, chorus deep gold, pre-chorus and tag copper, intro antique gold, outro dark bronze, and the bridge and ending in navy, so the parts are easy to tell apart.

**Lineup (left):**
- **Rearrange** by dragging the ⋮⋮ handle of an item. With the keyboard: Tab to the handle, press Space, move with ↑/↓, press Space again. The new order is saved in the service.
- **A theme per song:** open *Themes and backgrounds* at the bottom of the lineup (type in the search box to find one) and drag a theme onto any song or item, or select an item and click a theme. The panel folds itself away after two minutes without use, to give the lineup room.
- **A video or picture behind a song:** in the same panel choose the **Videos** or **Pictures** tab (the folder buttons show one Media Library folder at a time) and drag one onto a song or item. Clicking a video or picture only picks it, so nothing changes on the screen by accident; then press **Use for item** to put it behind the selected item. It becomes that item's background and the rest of its look stays the same. *Import video…* / *Import picture…* adds a new one from your computer. The item shows the theme's name. *Item theme* above the slides does the same from a list; choose *as planned* to undo it.
- **Import** (the icon next to the service name) adds a PowerPoint, PDF or picture file to the service, as in the Service Planner.

| Key | Action |
| --- | --- |
| → or ↓ or Space or Page Down | Next slide |
| ← or ↑ or Page Up | Previous slide |
| Home / End | First / last slide of the item |
| B | Black screen (press again to return) |
| C | Clear text, keep the background |
| L | Logo screen (see below) |
| Esc | Take everything off the screen (the output stays open) |

Shortcuts never trigger while you type in a text box, and they also work if the projector window has focus. They can be changed in Settings → Keyboard.

- **Customize a look:** drag **Customize** (the first card under Themes) onto a song or Scripture item, or press **Customize…** above the slides. Change the font (including Poppins, Montserrat and Outfit, which are built in and work offline), text size, bold, italic, shadow, outline, letter case (*As typed*, *Title Case* such as "What Could Separate Us Now?", or *CAPITALS*), colour, text width, line spacing, alignment and position; the background (a looping video, a picture, a colour or black, with *Darken* to keep the words readable); and the transition between slides (*Fade*, *Slide across*, *Rise up*, *Zoom*, *Blur* or *None*) and its time, all with a live preview. **Save for this item** gives that item its own look (editing it again updates the same look); **Save as new theme…** keeps the look as a named theme you can use for other songs too; **Save to theme** changes the theme for every item that uses it (not offered for the built-in themes). The output changes with a smooth dissolve.
- **Clear stays on** until you press Clear again: you can choose or double-click other slides and items while it is on, and only their background shows. A yellow note above the slides reminds you. (Black and Logo give way to the slide you choose, as before.)
- **Next stays within the item:** on the last slide of a song (or any item), Next and the arrow keys do nothing, so the output never moves to another song by accident. The NEXT box says so; click (or double-click) the next item in the lineup to continue. To have Next carry on into the next item, turn on Settings → Presentation → *Next continues into the next service item* (then ↓ / ↑ jump between items).
- **Songs with music:** when a song with music is on screen, the **Song music** box appears on the right. **Play music** plays it through this computer and shows, by default, the **vinyl**: the album cover as the record sleeve with the title and artist, the record turning clockwise while the music plays (it stops when paused), and the line being sung below. Choose **Lyrics** for the current line very large with the next line under it, **Full song** for every line scrolling with the music, or **Slides** for the song's normal slides while the music keeps playing. ⏮⏭ jump to the previous or next line. Lyric size, alignment and the view shown when the music starts are in Settings → Presentation → Music.
- **Smooth changes:** slides, *Present now* and backgrounds dissolve into each other using the theme's fade time. Black, Clear, Logo and Stop fade instead of cutting. Settings → Presentation → *Fade for Black, Clear, Logo and Stop* sets how quickly (or turns it off).
- **Logo screen:** Settings → Presentation → *Logo screen*. Choose a picture or a video as the logo (*Import file…* adds one straight from your computer). A picture is shown in the middle at the size you choose; a video fills the screen and loops, silent unless you turn its sound on. Behind it, choose the current theme background, black, a colour, a picture or a looping video. The preview shows the result. Without a logo, the church name is shown.
- **Present now** (bottom of the Live page): its box types examples from your library (a verse, a song title, slides such as *Midweek Service*). Type a song title, a few words of its lyrics (the matching line is shown under the title, with your words highlighted), or a slide deck's name, and press Enter to show it immediately; these items join the lineup marked *Added live*, and you can add them to the service afterwards.
- **Bible passages from Present now** (for example *John 3:16*) do not join the lineup, and they use their own elegant theme (*Gold Scripture*, changeable in Settings → Presentation → *Bible verses from Present now*) rather than the service's song backgrounds. The whole chapter opens in the middle and the verse goes on screen. Click any verse to show it; **Ctrl+click** adds or removes verses to show several together, **Shift+click** takes a range, and **Several** makes plain clicks add verses. → and ← (and Next / Previous) move verse by verse. A long verse or passage is spread over several slides (the bar above the chapter says *slide 1 of 2*), and its reference, such as *John 3:16*, is always on screen. To keep a passage for later, drag the chosen verses onto the lineup (or press **Add to lineup**): it becomes an item in the service, after the item you drop it on, with an optional note such as *Tithes and offering* that shows in the lineup. The arrows next to the chapter name change chapter, and the box next to them changes translation. Choosing an item in the lineup puts the chapter away; the button with the chapter's name next to *Present* brings it back.
- **Videos** show play, pause and restart controls with progress.
- **If the projector is unplugged**, the output hides itself so it never covers your screen, keeps its place, and returns when the projector is reconnected.
- **If the computer restarts or SanctuaryFlow closes unexpectedly**, the service and slide are restored when you open it again. Click *Go Live* to continue.

## 7. Slides, themes and media

- **Slide Editor:** create announcement or sermon slides. Add text, images and shapes; drag to move, drag the corner to resize, arrow keys nudge. Slides use the theme background unless you give them their own. Save a deck as a template to reuse its layout.
- **Presentation Themes:** fonts (including the elegant *Playfair Display*), sizes, colours, alignment, safe margin, background (colour, image or video), overlay, Scripture reference style, verse numbers, song footer, corner logo and transition. Set default themes for songs, Scripture and announcements; individual songs, service items and decks can override them.
- **Transitions:** each effect (Fade, Slide across, Rise up, Zoom, Blur, None) is a tile. **Point at a tile** (or move to it with Tab) and the preview plays that effect, moving to the next sample slide; **click** to choose it. **Play transition** replays the chosen effect, for example after changing the duration.
- **Media Library:** import images, videos and audio (or drag files from Explorer, or use *Import file…* in any "Choose media" window). Your original files are not changed — SanctuaryFlow keeps its own copy. MP4 (H.264/AAC) and WebM play reliably; if a video does not play, convert it to MP4.


**Media Library:** it opens with a slideshow of your pictures (they fade one into the next; point at it to pause, or use the arrows and dots). Below are your **folders** and your media.

- **Import files** adds pictures, videos and audio (or drag them in from Windows Explorer). **Import a folder** takes a whole folder from your computer, subfolders included, and keeps it as a folder in the library.
- **New folder** makes an empty folder. Open a file and choose its **Folder** to move it; inside a folder, *Import into this folder*, **Rename** and **Remove folder** (its files stay in the library) are at the top.
- Audio files, and anything without a picture of its own, show the gold album picture.
- Folders are shared through cloud synchronization along with the other media details (not the files).
## 8. Backups

Backup & Restore → **Back up now** creates a `.sfbackup` file with all songs, services, Bible translations, themes, slides, settings and (if selected) media. Turn on **scheduled backups** to back up daily or weekly while SanctuaryFlow is open; old scheduled backups are removed automatically.

**Restoring:** choose a backup. It is checked first (checksums, database integrity, version). Your current library is saved as a safety backup before it is replaced, and if anything goes wrong the previous library is put back automatically.

Keep at least one recent backup off the computer, such as on a USB drive.

## 9. Synchronization (optional)

Synchronization shares songs, services, slides and themes between computers through your church's own Supabase project. Setup steps are in [SYNC_SETUP.md](SYNC_SETUP.md). Presenting never waits for the cloud; changes upload when a connection is available. If the same item was changed on two computers, it appears under **Conflicts** and nothing is overwritten until you choose *Keep mine*, *Keep theirs* or *Keep both*.

## 10. Troubleshooting

| Problem | What to do |
| --- | --- |
| The output opens on the wrong screen | Settings → Presentation → *Output display*: choose the projector, then press *Go Live* again. |
| Only one display is detected | Check the cable and Windows *Display settings* (use *Extend these displays*, not *Duplicate*). |
| Text is too small or too large | Edit the theme's font size and safe margin. Text shrinks automatically when a slide has a lot of words. |
| A video does not play | Convert it to MP4 (H.264 video, AAC audio). The operator screen shows the playback error. |
| A media file shows *File missing* | It was removed from the library folder. Import the same file again; it is matched by content. |
| "The library could not be opened" | Choose *Restore from backup* on that screen. The damaged files are kept next to the library. |
| A translation shows *Incomplete* | Open Details to see which books or chapters are missing. Missing passages show a message instead of text. |
| Sync shows an error | The service keeps working. Check the internet connection and sign-in under Synchronization. |

Log files are in `%LOCALAPPDATA%\org.sanctuaryflow.desktop\logs` (they never contain passwords or sign-in tokens).
