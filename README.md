# UE Eval Autofill

A bookmarklet that fills the UE Student Evaluation on Faculty Performance (apps.ue.edu.ph/websefp) for you. It picks your rating on every item (one rating, or a random mix of the ones you tick), clicks Next Item, handles the comment box and SUBMIT, and goes on to the next professor.

Student-made tool. Not affiliated with the University of the East.

## The bookmark (works on phones and computers)

Save this as a bookmark. It's short on purpose: it loads `auto.js` from this repository, so it also works on Android, which rejects long bookmarklets, and you get updates without re-copying.

```
javascript:(function(){var s=document.createElement('script');s.src='https://cdn.jsdelivr.net/gh/LVZ-18/ue-eval-autofill@main/auto.js';document.body.appendChild(s);})()
```

### Add it

- **Android (Chrome):** bookmark any page (⋮ → ☆), edit it: Name `UE Eval Autofill`, URL: paste the code above.
- **iPhone (Safari):** Share → Add Bookmark on any page, then Bookmarks → Edit → tap it, change the name and paste the code as the address.
- **Computer (Chrome):** Ctrl+Shift+O → ⋮ → Add new bookmark, Name `UE Eval Autofill`, URL: paste the code.

### Run it

Log in to the UE portal and open the faculty evaluation, then:

- **Android:** tap the address bar, type `UE Eval Autofill`, and tap the bookmark (star) in the suggestions. Opening it from the Bookmarks list doesn't run it.
- **iPhone:** Bookmarks → UE Eval Autofill.
- **Computer:** click it in the bookmarks bar.

A panel appears in the bottom-right corner. Tick your rating(s), choose what happens at the end (wait for my comment / submit without comment / submit with a comment), then press **Start**. On a phone, tap **–** to make the panel small.

## Is my account safe?

It runs only on the UE evaluation page, after you've logged in yourself. It never asks for or sees your student number or password and sends nothing anywhere. The full code is in [`auto.js`](auto.js). You're still responsible for the ratings you submit.
