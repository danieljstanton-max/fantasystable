# The tips server

The nightly card and the ten-minute sweep run on a Hetzner box, not on Dan's
Mac. The Mac was the original home and the reason for moving is simple: it has
to be awake and unlocked for launchd to fire, and it often isn't. Racing does
not wait.

    host      89.167.91.132   (Hetzner, Ubuntu 26.04, 1 vCPU / 1.9GB / 38GB)
    repo      /opt/racing-site
    published /root/Racing Tips
    schedule  /etc/cron.d/racing-site
    timezone  Europe/London — the schedule is written in wall-clock racing time

## The two jobs

    */10 7-23 * * *   npm run sweep    card, prices and results
    0 18 * * *        npm run daily    tomorrow's card, before the site rolls over
    1 19 * * *        publish-results  yesterday's results — here only to clear the cache

The build time is not arbitrary. WordPress switches the homepage to tomorrow's
card at 19:00 (`hrt_switch_hour`). While the build ran at 22:15 there was a
three-hour window every evening where the site wanted tomorrow's card, found
none and stayed on today's — which reads as a site that has stopped updating.
Declarations are long out by 18:00, and today's results are not needed for
tomorrow's form. If you move one of these, move the other.

The 19:01 job exists because the switch is not a push. WordPress starts
serving tomorrow's card at 19:00, but LiteSpeed and Hostinger's CDN go on
serving the cached homepage — today's NAP and Lucky 15 — until something
purges, and only a REST push does that. Yesterday's results always reach the
site and that route always purges, so it is used as a purge that cannot be
skipped. Move `hrt_switch_hour` and this moves with it.

`sweep` appends to `/root/Racing Tips/_results-log.txt`, `daily` to `_log.txt`.
Read those first when something looks wrong; they are the whole story.

## The published files are part of the system

`~/Desktop/Racing Tips` on the Mac, `/root/Racing Tips` on the server. They are
not a backup — settlement, the month widget, vetoes and hand picks all read
them. They are the record of what was actually advised, at the price it was
advised at, and the pipeline deliberately never re-derives that from the model.

This bit the deployment. Eight files each carried their own copy of
`join(homedir(), "Desktop", "Racing Tips")`. On the server `homedir()` is
`/root`, so all eight looked in `/root/Desktop/Racing Tips`, which does not
exist. The sweep found nothing, concluded nothing had ever been advised, and
pushed a month of zeros to the live widget.

`lib/published.ts` now owns `OUT_DIR` and honours `HRT_OUT_DIR`; everything
else imports it. On the server:

    HRT_OUT_DIR=/root/Racing Tips

If you ever add a script that writes a published file, import `OUT_DIR`. Do not
write the path again.

## Only one machine may publish

Two machines running the same schedule fight over the odds — both push, and the
advised price becomes whichever landed last. The Mac's launchd jobs are
therefore parked, not merely unloaded:

    ~/Library/LaunchAgents/io.horseracingtips.daily.plist.disabled-server-took-over
    ~/Library/LaunchAgents/io.horseracingtips.results.plist.disabled-server-took-over

Renamed so a future login cannot quietly reload them. To fail back to the Mac,
rename them and `launchctl load` — but stop cron on the server first.

## Copying files to the box

The published directory has a space in its name and rsync splits on it: the
remote path silently becomes two paths, and most of the files land in
`/root/Racing`. macOS ships rsync 2.6.9, which has no `--protect-args`. Use tar
over ssh instead, which never parses the path:

    cd ~/Desktop && tar czf - "Racing Tips" | ssh root@89.167.91.132 \
      'tar xzf - -C /root/_incoming && mv "/root/_incoming/Racing Tips" /root/'

macOS tar also writes `._` AppleDouble shadows; delete them on arrival or every
file appears twice.

## The nightly email

`scripts/daily-report.ts` calls `sendDailyReport()` at the end of every run —
four gates, then either "published" or "HELD — approval needed" with the
reasons. It goes to `DAILY_REPORT_TO` through Resend. The point is that the
checks run whether or not anyone remembers to ask for them.

## Secrets

`.env.local` lives on the box at `/opt/racing-site/.env.local` and is not in
git. Rotate the database password with `deploy/set-db-password.sh`, which
prompts hidden, tests against Neon and copies it up. Never paste a credential
into a chat window — a password that has been pasted is burned and has to be
rotated again.
