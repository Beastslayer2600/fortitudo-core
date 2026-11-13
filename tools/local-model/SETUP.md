# Your own model on your PC

The Fortitudo agent thinks with an open-weight model that runs on your own PC
(DESKTOP-43NSST2). Nothing is billed per message and no outside company sees
the prompts. The gateway on Vercel reaches the PC through a private tunnel,
and a small proxy on the PC only lets through chat requests that carry your
secret token.

```
Front door ─▶ Vercel gateway ─▶ Tailscale Funnel ─▶ proxy.mjs (token check) ─▶ Ollama ─▶ the model
```

Your PC has no separate graphics card, so the model runs on the processor.
`qwen3:4b` is the starting model: it fits easily in 16 GB and handles tools.
Expect a reply in roughly one to three minutes. `qwen3:8b` writes better at
about half the speed. To switch, pull it and change `AGENT_MODEL` in Vercel.

## 1. Keep the PC awake

Settings → System → Power → Screen and sleep. Under "When plugged in, put my
device to sleep after", choose **Never**. The screen may still turn off.

## 2. Install Ollama and the model

1. Download and install Ollama for Windows from https://ollama.com/download.
2. Open PowerShell and run:
   ```
   ollama pull qwen3:4b
   ollama run qwen3:4b "Say hello in one sentence."
   ```
   If you get a sentence back, the model works. Ollama starts with Windows on its own.

## 3. Install Node.js

Download the LTS version from https://nodejs.org and install it with the defaults.

## 4. Get the proxy

1. On https://github.com/Beastslayer2600/fortitudo-core choose Code → Download ZIP.
2. Extract it to `C:\Fortitudo`. The proxy is in `C:\Fortitudo\fortitudo-core-main\tools\local-model`.

## 5. Make the secret token

In PowerShell, inside that `tools\local-model` folder:

```
cd C:\Fortitudo\fortitudo-core-main\tools\local-model
$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
(($b | ForEach-Object ToString x2) -join '') | Set-Content token.txt -NoNewline
Get-Content token.txt
```

Copy what it prints. That is `AGENT_MODEL_TOKEN`; you'll paste it into Vercel
in step 8. Don't share it or paste it into chat.

## 6. Start the proxy

Double-click `start-proxy.cmd`. A window opens saying
`Fortitudo model proxy on http://127.0.0.1:8787`. Leave it open.

To start it with Windows: press Win+R, type `shell:startup`, and put a
shortcut to `start-proxy.cmd` in the folder that opens.

## 7. Open the tunnel

1. Install Tailscale from https://tailscale.com/download and sign in (the free plan is enough).
2. In PowerShell run:
   ```
   tailscale funnel --bg 8787
   ```
   The first time, it prints a link to turn on HTTPS and Funnel for your account. Open it, approve, and run the command again.
3. It prints your public address, something like
   `https://desktop-43nsst2.your-tailnet.ts.net`. That is `AGENT_MODEL_URL`.

`--bg` keeps the tunnel on after restarts.

## 8. Tell Vercel

In the fortitudo-core-core project → Settings → Environment Variables (Production):

| Name | Value |
| --- | --- |
| `AGENT_MODEL` | `qwen3:4b` |
| `AGENT_MODEL_URL` | the address from step 7 |
| `AGENT_MODEL_TOKEN` | the token from step 5 |
| `AGENT_DAILY_REQUEST_CAP` | optional, defaults to `100` |

Then redeploy.

## 9. Check it

From PowerShell, in the `tools\local-model` folder:

```
Invoke-RestMethod "<your address>/health" -Headers @{ Authorization = "Bearer $(Get-Content token.txt)" }
```

`ollama: up` means the whole path works. Without the token the same address
answers `unauthorized`, which is what you want.

## If the agent says "Your PC did not answer"

- Is the PC on and awake?
- Is the `start-proxy.cmd` window open?
- Does `tailscale funnel status` show port 8787?
- Does `ollama list` show the model?
