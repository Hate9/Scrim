# Installing Pandoc

Scrim exports to Word, OpenDocument, RTF, EPUB, LaTeX, MediaWiki, reStructuredText,
Textile, OPML, Org, and plain text, and imports those formats, with **pandoc**, a
separate program. PDF and HTML export do not need it.

## Linux

Install the `pandoc` package with your distribution's package manager, for example:

- Debian, Ubuntu: `sudo apt install pandoc`
- Fedora: `sudo dnf install pandoc`
- Arch: `sudo pacman -S pandoc`

## Windows

Install pandoc with the installer from the pandoc project, or with
`winget install --id JohnMacFarlane.Pandoc`.

## After installing

Scrim looks for `pandoc` on your `PATH` each time a window opens. If pandoc is
installed somewhere else, set its location in **Preferences → Export → Pandoc path**.
The pandoc formats in **File → Export** are enabled once Scrim finds it.
