# Organizer's guide

How to run a robot combat meetup with BattleScene once your copy is deployed. To set up your own copy, see the [README](../README.md#run-your-own-battlescene-free). The [product specification](SPEC.md) covers every behavior in detail.

- [Staff access](#staff-access)
- [Run a meetup](#run-a-meetup)
- [Team registration](#team-registration)
- [Set up displays](#set-up-displays)
- [Display language](#display-language)

## Staff access

Everyone signs in with Google. There are three kinds of account:

| Role | Who | Can do |
|---|---|---|
| **Super admin** | The Google address in `BOOTSTRAP_ADMIN_EMAIL` | Everything: manage any meetup, grant and revoke manager access, transfer ownership, confirm result corrections that affect battles already started, and fill a meetup with demo data. |
| **Meetup manager** | Addresses a super admin adds under **General settings → Global manager access** | Create meetups, run the meetups they own or are assigned to, and add other managers to them under **Meetup settings → Meetup access**. |
| **Team** | Any other Google account | Only the team registration pages: register, edit, and cancel their own robots. |

To change who holds the super admin role, update `BOOTSTRAP_ADMIN_EMAIL` in Vercel and redeploy.

## Run a meetup

Open **Meetups** to see the date and status of each meetup you can manage. Select a meetup to open its **Overview**. The sidebar splits the meetup into **Run the event** (Overview, Check-in, Arenas, Brackets) for event day and **Set up** (Robots & classes, Displays, Meetup settings) for preparation. The class selector shows the active class as you move between Arenas and Brackets.

1. In **Meetups**, select **New meetup**. Open **Robots & classes** and select **Add weight class**. Pick a common class (Antweight, Beetleweight, Featherweight, or Heavyweight) or type a name, name its dedicated arena, and choose the bracket format in the same form.
2. In **Robots & classes**, select a class to register or paste in its teams and robots and set the seed order. Or let teams register themselves: open **Meetup settings → Team registration**, select **Open registration**, and share the link or print its QR code (see [Team registration](#team-registration)).
3. On event day, open **Check-in**. Search for a robot or team, or filter by class, and select **Check in** as each robot arrives.
4. Open **Brackets**, select the class, and select **Generate bracket**. Pick **Single elimination**, **Double elimination**, or **Rounds (2 losses out)** and review the pairings. In the rounds format, everyone left fights once per round and two losses is out. Only round 1 is shown up front; each later round fills in automatically as battles end, pairing robots on the same record as soon as both are free. Only checked-in robots enter the bracket. Until the first battle, checking a robot in or out updates the bracket. You can change the format until a battle starts or a result is saved in that class. Generating again replaces its current pairings. Entries close when the first battle starts.
5. Open **Arenas** and select the class, or use **Run arena** on its Overview card. Start the next ready battle and record the winning robot. Use **Win** after a played battle or **Forfeit** if the opponent concedes or cannot compete. Both outcomes advance the winner. Use **Earlier**, **Later**, and **Hold** to manage the queue. If robots don't reach the arena, select **Last call** on that battle. When the countdown ends, select which robot advances by forfeit. If a robot leaves the event, select **Withdraw** on its **Check-in** row to forfeit all of its remaining battles.
6. Use **Overview** or **Arenas** to activate and deactivate each arena. Deactivating an arena pauses its clock and marks it inactive in Ringmaster view. Reactivate the arena and select **Resume** when play can continue.
7. Select **Publish meetup** in **Overview** and [share a spectator link](#set-up-displays). After all populated brackets finish, select **Meetup settings → Mark meetup complete** and confirm. The published page stays available with the results. Completing a meetup clears its activity log to save space; reopening it does not bring the log back.

To remove a weight class, select **Remove** beside it in **Robots & classes** and confirm. This removes its roster, bracket, results, and arena from the meetup. Venue displays assigned to the class switch to Ringmaster view and keep their links. Reopen a completed meetup before removing a class.

To try the app out, a super admin can select **Fill with demo data** in **Robots & classes**. Choose how many classes to add and how many robots go in each; the defaults are two classes with 18 and 6 robots. Each class gets its own arena and a roster of checked-in robots, added alongside any classes the meetup already has. Then generate the brackets as usual.

To delete a whole meetup, open **Meetup settings → Delete meetup**, type the meetup's name, and confirm. Only the meetup's owner or a super admin can delete it. Deleting permanently removes the meetup, its uploaded images, and its activity log, and its spectator links stop working. Super admins see the deletion in the **General settings** activity log.

## Team registration

Teams can register their own robots through a secret link for each meetup. Open **Meetup settings → Team registration**:

- **Open registration** / **Close registration** turns new registrations on or off. It works while the meetup is still a draft.
- **Copy link** copies the link to paste into a group chat. **Print QR** prints a sheet with the link's QR code for the venue door.
- **Regenerate link** replaces the link if it was shared too widely. The old link stops accepting new robots right away. Teams who already registered can still edit their robots.

On the link, a team selects **Continue with Google**, adds a contact phone number once, and registers robots with a team name, robot name, weight class, optional weapon type, and optional photo. The photo is cropped to a square and compressed on the phone before upload. Robots go straight onto the roster, not checked in, with a **Team** tag. Teams can edit their robots at any time and change class or cancel until the class starts. One Google account can register up to five robots in a meetup. If a team needs more, add them yourself in **Robots & classes** and type the team's Google address as **Owner email**. An account is also limited to 100 changes and 30 photo uploads a day, far more than a team needs; a team that sees "try again tomorrow" can ask you to make the change. Each robot is also saved to the team's garage, so the team can enter it in a later meetup in one tap. The pages follow the meetup's display language, with an **EN / עב** toggle.

Staff can add or replace any robot's photo and weapon type from **Edit** in the roster. To hand a staff-entered robot to a team, type the team's Google address as **Owner email**. Robots without a photo show a mech placeholder on the screens.

## Set up displays

**Ringmaster view** shows active battles and timers at the top, all ladders in the middle, and each arena's next ready battle at the bottom. **All ladders** is available as a display layout. Select a class or arena in Ringmaster view to see its details.

In **Displays**, add or edit a named display and pick its layout. For example, use **Ringmaster view** on the main TV or **In battle** on an arena screen. Open the display on its TV and select **Toggle fullscreen**. You can configure up to 10 displays per meetup and update their layouts while their venue links stay the same. New meetups start with one display named **Ringmaster** in Ringmaster view, which you can edit or remove like any other.

To share the meetup with spectators, edit the intended display, check **Spectator view**, and save. Use **Copy link** on that row to share it; on the venue screen itself, use **Open display**, which shows the same view and refreshes faster. The same public link follows the current designation. When no display is designated, it opens Ringmaster view.

Use **Displays** to set spectator branding and QR actions.

## Display language

To show spectator pages and venue displays in Hebrew, open **Meetup settings**, set **Display language** to **עברית**, and save. Hebrew displays read right to left, with each ladder's first round on the right. The staff dashboard stays in English, and you can switch the language back at any time.
