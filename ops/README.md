# The daily job

`npm run daily` ingests tomorrow's racecards, fetches career form for the
declared runners, scores the card and writes three files to
`~/Desktop/Racing Tips/`:

| File | What it is |
|---|---|
| `YYYY-MM-DD card.txt` | The full analysis, every qualifying race |
| `YYYY-MM-DD card.html` | The same thing, readable on a phone |
| `YYYY-MM-DD flagged.csv` | The well-handicapped shortlist, for tracking |

## Schedule

Runs at **19:00 daily** via launchd. Tomorrow's prices are published during the
evening before — at 15:49 on 26 August none of 379 runners were priced, and by
19:25 all 378 were — so 19:00 is late enough to have them and early enough to
act on.

    ops/io.horseracingtips.daily.plist   copy of the installed agent

Check it:

    launchctl list | grep horseracingtips

Run it now without waiting:

    launchctl start io.horseracingtips.daily

Stop it:

    launchctl unload ~/Library/LaunchAgents/io.horseracingtips.daily.plist

Reinstall after editing:

    cp ops/io.horseracingtips.daily.plist ~/Library/LaunchAgents/
    launchctl unload ~/Library/LaunchAgents/io.horseracingtips.daily.plist
    launchctl load ~/Library/LaunchAgents/io.horseracingtips.daily.plist

Anything the job prints, including failures, goes to
`~/Desktop/Racing Tips/_log.txt`.

## Why a folder and not email

Sending mail needs credentials for a mail account held somewhere a script can
read them. A folder needs no secrets, works whether or not anything else is
running, and syncs on its own if the folder sits inside iCloud Drive or
Dropbox.

## If the Mac is asleep at 19:00

launchd runs the job when the machine next wakes. It does not skip the day.
