---
name: login-github
description: "How to login to Github using pinchtab"
---

# Login to Github Skill

When asked to login to GitHub, use the following `pinchtab` sequence:

1. `pinchtab navigate "https://github.com/login"`
2. `pinchtab type "#login_field" "<username>"`
3. `pinchtab type "#password" "<password>"`
4. `pinchtab click "[name='commit']"`

Verify by checking if the URL changes or the "Dashboard" text is present.