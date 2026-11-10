# CRELUNE
## Product Master Specification
**Document Version:** 1.0  
**Project Status:** Planning and Architecture  
**Product Owner:** Founder / Sole Administrator  
**Development Environment:** Windows 11  
**Primary Creative Application:** Affinity 3.3  
**Development Platform:** Google Antigravity  
**Product Category:** Creative and Media Operations Software

---

# 1. PRODUCT OVERVIEW

## 1.1 What is CRELUNE?

CRELUNE is a personal creative and media operations platform designed to help an individual manage creative responsibilities, church media activities, people, events, design projects, creative assets and production workflows from one organised environment.

CRELUNE is initially being developed for one person: its founder and sole administrator.

The product must solve the founder's actual problems before attempting to support an entire media department or multiple organisations.

CRELUNE combines:
- Personal creative work management.
- Member and birthday management.
- Event and programme management.
- Graphic design project management.
- Creative template organisation.
- Creative asset management.
- Affinity desktop integration.
- Mobile productivity and reminders.

CRELUNE is not intended to be another messaging application, a simple birthday reminder, or a generic task manager.

It should become a unified workspace where information enters the system, gets organised, becomes actionable work and eventually results in completed creative output.

## 1.2 The Problem

The founder performs creative and media responsibilities within a church environment.

These responsibilities can include:
- Designing birthday flyers.
- Preparing programme flyers.
- Designing announcements.
- Managing church-related creative materials.
- Remembering important dates.
- Keeping track of unfinished designs.
- Finding the correct templates and photographs.
- Organising design resources.
- Remembering which designs have been completed or published.

The current workflow relies heavily on memory, manually checking information, scattered files and separate tools.

This creates several problems:

1. Important birthdays can be forgotten.
2. Design work can be delayed because information is not organised.
3. Templates and creative resources can become difficult to locate.
4. There is no single view of upcoming creative responsibilities.
5. Completed and unfinished designs can become difficult to distinguish.
6. Repetitive design preparation consumes time that could be spent on actual creativity.

CRELUNE should reduce this operational burden.

## 1.3 Product Vision

To create a beautifully designed, reliable and intelligent creative operations workspace that helps individuals organise their creative responsibilities and turn information into finished work.

## 1.4 Product Mission

Help the founder spend less time remembering, searching, organising and preparing, and more time creating.

## 1.5 Product Principles

Every feature must follow these principles:

1. **Personal first:** Build for the founder's actual needs.
2. **Creative control:** The system assists with preparation; the founder controls the final creative result.
3. **Automation with approval:** Automated operations must be predictable and reversible wherever practical.
4. **One source of truth:** Members, events, designs, templates and assets should have clear central records.
5. **Mobile convenience:** Important information and reminders should be accessible from a phone.
6. **Professional design:** The interface must feel like a polished commercial software product.
7. **Reliability over feature count:** A smaller feature that works correctly is better than many incomplete features.
8. **Expandable architecture:** Future team collaboration must be possible without forcing team features into the first release.

---

# 2. BRAND IDENTITY

## 2.1 Brand Name

CRELUNE

Pronunciation: Kreh-loon.

CRELUNE is an invented brand name selected for its creative, artistic and modern personality.

The name is a working product identity. Domain registration and trademark clearance must be completed before public commercial launch.

## 2.2 Brand Personality

CRELUNE should feel:
- Creative.
- Artistic.
- Modern.
- Elegant.
- Professional.
- Calm.
- Organised.
- Technologically capable.

It should not look like an ordinary church administration system.

## 2.3 Brand Positioning

**CRELUNE — Create. Organise. Bring ideas to life.**

Position CRELUNE as a creative operations platform, rather than limiting its identity to birthday management or church administration.

## 2.4 Visual Direction

The interface should take inspiration from professional creative applications and modern productivity software.

Design requirements:
- Strong typography.
- Excellent spacing.
- Clear visual hierarchy.
- Consistent icons.
- Restrained use of colour.
- Subtle shadows and borders.
- Thoughtful empty states.
- Carefully designed responsive layouts.
- Clear loading, success and error states.

Avoid:
- Excessive gradients.
- Unnecessary glassmorphism.
- Generic AI-generated dashboard aesthetics.
- Too many rounded cards.
- Excessive badges.
- Decorative elements that reduce usability.
- Oversized navigation.
- Unnecessary animations.

The interface should feel intentionally designed, not generated from a generic dashboard template.

## 2.5 Brand Colour Direction

Initial proposed palette:

- Primary: Deep creative violet — #6541A5
- Secondary: Muted lavender — #A99AD1
- Background: Soft neutral — #F8F7FA
- Surface: White — #FFFFFF
- Primary text: Deep charcoal — #24212B
- Secondary text: Muted grey — #77727F
- Borders: #E8E5ED
- Success: Restrained green.
- Warning: Restrained amber.
- Error: Restrained red.

These are initial design tokens, not immutable values. The final palette should be refined through the actual interface design.

Dark mode should be supported eventually, but light mode is the initial design priority.

---

# 3. PRODUCT OWNERSHIP AND USERS

## 3.1 Initial Ownership

CRELUNE is initially a single-owner product.

The founder is:
- Product owner.
- System administrator.
- Primary user.
- Creative operator.
- Final approval authority.

There will be no public registration system in the first release.

## 3.2 Initial Account Model

The first version supports one owner account.

The system must not expose sensitive member information or creative assets publicly.

Authentication must protect all private application routes and APIs.

## 3.3 Future Expansion

The architecture should support future roles such as:
- Owner.
- Media Leader.
- Designer.
- Photographer.
- Videographer.
- Social Media Manager.
- Projection Operator.
- Sound Operator.

However, these roles are future capabilities, not first-release implementation requirements.

Do not build invitations, team chat, multi-user assignments or complex collaboration features during the initial milestones.

## 3.4 Future Multi-Organisation Support

The architecture should avoid decisions that make future organisation separation impossible.

However, CRELUNE must not be overengineered into a multi-tenant SaaS product at the beginning.

The initial installation is for one owner and one organisation context.

---

# 4. PLATFORM STRATEGY

CRELUNE will consist of three connected components.

## 4.1 CRELUNE Web

The web application is the main management and creative workspace.

It is intended for use on the founder's Windows computer.

Primary responsibilities:
- Dashboard.
- Member management.
- Birthday calendar.
- Event management.
- Design management.
- Template management.
- Asset library.
- Creative preparation.
- Reports.
- Settings.

The web application must be fully responsive.

Desktop should provide the complete workspace, while smaller screens should remain usable.

## 4.2 CRELUNE Mobile

The mobile application is the founder's everyday companion.

It should not simply be a compressed web dashboard or an embedded WebView.

Its interface should be designed around mobile interactions.

Initial capabilities:
- View upcoming birthdays.
- Receive birthday reminders.
- Register members.
- Add or update member photographs.
- View events.
- Create design tasks.
- Check design progress.
- View completed designs.
- Access important creative assets.
- Receive important application notifications.

The mobile platform target is not yet finalised. The architecture must support Android and iOS without requiring two separate backend systems.

Native device capabilities should be used where appropriate.

## 4.3 CRELUNE Windows Creative Agent

The Windows Creative Agent connects CRELUNE to the founder's local computer and Affinity.

Its responsibilities include:
- Securely connecting to the CRELUNE account.
- Receiving approved creative jobs.
- Downloading required images and job information.
- Locating registered local templates.
- Launching or communicating with Affinity through supported mechanisms.
- Coordinating approved scripts.
- Reporting processing results.
- Managing local temporary files.
- Keeping original templates protected.

The agent must run independently from the web application.

A browser-only implementation must not pretend it can freely access or control local desktop applications.

## 4.4 Shared Backend

All platforms use one shared backend and one authoritative data model.

Conceptual structure:

CRELUNE Web ─────┐
CRELUNE Mobile ──┼── Shared API ── Database
Windows Agent ───┘        │
                          └── File Storage

Changes made on one platform should become visible on the other platforms through the shared backend.

---

# 5. CORE PRODUCT MODULES

# MODULE 1: DASHBOARD

## Objective

Give the founder a clear overview of upcoming responsibilities and creative activity.

## Dashboard Sections

1. Welcome and current date.
2. Upcoming birthdays.
3. Upcoming programmes.
4. Pending designs.
5. Designs in progress.
6. Designs awaiting approval.
7. Recently completed designs.
8. Quick actions.
9. Important reminders.

## Dashboard Behaviour

The dashboard should prioritise information that requires attention.

It should not be filled with meaningless statistics.

Examples of useful information:

- Three birthdays coming this week.
- One birthday flyer awaiting preparation.
- Two designs currently in progress.
- One programme happening this Sunday.
- One completed design awaiting publication.

Quick actions:
- Add Member.
- Add Birthday.
- Create Programme.
- Create Design Task.
- Add Template.
- Upload Asset.

---

# MODULE 2: MEMBER MANAGEMENT

## Objective

Maintain an organised directory of people whose birthdays and related creative activities need to be managed.

## Member Information

Each member record should support:

Required:
- Full name.
- Birthday.

Optional:
- Profile photograph.
- Phone number.
- Email.
- Additional notes.
- Active/inactive status.
- Date added.

The application should minimise the personal information it collects.

Do not require unnecessary personal information.

## Member Operations

The founder must be able to:
- Add members.
- View member profiles.
- Edit member information.
- Upload photographs.
- Replace photographs.
- Search members.
- Filter members.
- Archive inactive members.
- Restore archived records.

## Member Profile

A member profile should display:
- Profile photo.
- Full name.
- Birthday.
- Upcoming birthday information.
- Related birthday designs.
- Relevant notes.

## Birthday Data Rules

Store birthdays using a date-only representation.

Do not allow timezone conversion to shift someone's birthday to the previous or following day.

If the year of birth is unknown, support storing month and day without inventing a birth year.

The founder should be able to correct inaccurate birthday records.

---

# MODULE 3: BIRTHDAY MANAGEMENT

## Objective

Ensure that important birthdays are never forgotten and birthday designs are prepared in time.

This is the first major business workflow and one of the highest-priority modules.

## Birthday Calendar

Provide:
- Monthly calendar.
- Upcoming birthday list.
- Today's birthdays.
- This week's birthdays.
- This month's birthdays.
- Search and filtering.

## Reminder Schedule

Initial configurable reminder intervals:

- Seven days before.
- Three days before.
- One day before.
- On the birthday.

The founder should be able to change or disable reminder intervals.

Do not send duplicate notifications for the same reminder event.

## Birthday Workflow

1. Member is registered.
2. Birthday is recorded.
3. CRELUNE calculates the next birthday.
4. Reminder schedule is generated.
5. Founder receives reminders.
6. Founder opens the member profile.
7. Founder starts a birthday design.
8. A template is selected.
9. Required information and photograph are prepared.
10. Founder edits and reviews the design.
11. Design is exported.
12. Design is marked completed or published.

## Birthday Statuses

- Upcoming.
- Preparation Pending.
- Design in Progress.
- Awaiting Approval.
- Published.
- Skipped.

The founder must be able to manually update statuses.

The system must not mark a design as published simply because an export succeeded.

## Recurring Birthday Behaviour

Birthdays recur annually.

The system must calculate future birthdays correctly, including leap-year edge cases.

For someone born on 29 February, define a configurable policy for non-leap years rather than silently assuming one.

---

# MODULE 4: DESIGN MANAGEMENT

## Objective

Give the founder one organised place to manage every design assignment.

## Design Types

Initial design categories:
- Birthday Flyer.
- Church Programme Flyer.
- Event Announcement.
- Service Flyer.
- Social Media Graphic.
- Special Event Artwork.
- General Graphic Design.

Categories must be editable in future settings.

## Design Job Information

Each design job should contain:
- Design title.
- Design category.
- Related member, if applicable.
- Related event, if applicable.
- Required text.
- Design dimensions.
- Target platform.
- Preferred template.
- Reference files.
- Deadline.
- Priority.
- Status.
- Notes.

## Design Statuses

- Draft.
- Pending.
- In Progress.
- Awaiting Review.
- Approved.
- Exported.
- Published.
- Cancelled.

## Design Workflow

1. Create a design job.
2. Enter required information.
3. Attach relevant member or event records.
4. Select a template or start from scratch.
5. Prepare the design.
6. Open the design in Affinity.
7. Make creative adjustments.
8. Review.
9. Export.
10. Mark as completed.
11. Record publication information if relevant.

## Design History

A design job should retain its history.

Record important transitions such as:
- Job created.
- Template selected.
- Preparation started.
- File exported.
- Design approved.
- Design published.

The history should include timestamps and the acting account.

---

# MODULE 5: TEMPLATE MANAGEMENT

## Objective

Organise reusable creative templates and safely prepare them for individual design jobs.

## Supported Initial Formats

- Affinity-native document formats.
- PSD files.
- Other image formats as reference assets.

Do not assume every PSD feature will remain fully editable when imported into Affinity.

PSD compatibility must be tested against real templates.

## Template Registration

When a template is added:

1. Record its name.
2. Record its file type.
3. Record its dimensions.
4. Store its original location.
5. Register a protected source copy where appropriate.
6. Inspect its document structure through supported Affinity capabilities.
7. Identify potentially editable text and image layers.
8. Allow the founder to map document elements to CRELUNE fields.
9. Save the mapping.
10. Test preparation on a disposable copy.

## Template Mapping

Example:

| Template Element | CRELUNE Field |
|---|---|
| Member name text layer | member.fullName |
| Birthday date layer | birthday.formattedDate |
| Greeting text layer | birthday.greeting |
| Portrait image layer | member.photo |
| Church logo layer | organisation.logo |

Mappings must be configurable.

Do not assume all templates have the same layer names.

## Template Safety Rules

- Never overwrite original templates.
- Always work on a duplicate or generated copy.
- Preserve the original document.
- Never rename or restructure original layers automatically.
- Allow the founder to inspect mappings before generation.
- Record errors instead of silently skipping failed replacements.
- Provide a clear way to restore or regenerate from the original.

## Template Library

Support:
- Search.
- Categories.
- Tags.
- File format filtering.
- Preview images.
- Favourite templates.
- Last-used information.
- Template status.

Possible categories:
- Birthday.
- Church Events.
- Worship.
- Conferences.
- Announcements.
- Social Media.

---

# MODULE 6: AFFINITY INTEGRATION

## Objective

Connect CRELUNE to the founder's actual creative environment without compromising document safety.

## Environment

- Operating System: Windows 11.
- Application: Affinity 3.3.
- Creative Studios: Pixel, Vector and Layout.
- Existing template formats: PSD and native Affinity formats.

## Integration Strategy

Use supported Affinity scripting and SDK capabilities where available.

Official documentation reference:

https://sdk.affinity.studio/3.3.3/js/

Gravity must verify the exact APIs available in the installed version before implementing integration.

Do not invent methods, API capabilities, undocumented automation mechanisms or unsupported behaviours.

## Architecture

CRELUNE Web
   |
   v
CRELUNE Backend
   |
   v
Windows Creative Agent
   |
   v
Supported Affinity Integration
   |
   v
Affinity Desktop Application

## Integration Capabilities to Validate

- Detect installed Affinity application.
- Detect application version.
- Identify active document where supported.
- Read document information.
- Inspect layer hierarchy.
- Identify text objects.
- Identify image or placed-resource objects.
- Inspect layer visibility and relevant properties.
- Save a document as a new copy.
- Export PNG.
- Export JPEG.
- Export PDF where supported.
- Report operation success or failure.

Each capability must be proven experimentally.

## Controlled Design Preparation

The intended workflow:

1. CRELUNE creates a design job.
2. Backend prepares the job manifest.
3. Windows Agent downloads the required data and assets.
4. Founder chooses to process the job.
5. Affinity opens the relevant document.
6. Supported Affinity scripting performs approved operations.
7. Changes are applied to a new working document.
8. Founder inspects the result.
9. Founder performs final creative adjustments.
10. Founder exports the final design.
11. CRELUNE records the result.

## Important Limitation

Affinity's scripting environment and external desktop automation are not interchangeable.

Do not assume a regular Node.js process can directly modify every Affinity document.

Use the application's supported scripting runtime for operations that require access to the document model.

If an operation is unsupported, report the limitation and offer a manual handoff.

## Affinity Integration Acceptance Criteria

- Installed application detected.
- Application version recorded.
- Active document inspected.
- Native Affinity document tested.
- PSD document tested.
- Layer inspection verified.
- A separate working copy created.
- PNG export verified.
- Original files remain unchanged.
- Unsupported operations are clearly reported.

---

# MODULE 7: CREATIVE ASSET LIBRARY

## Objective

Keep frequently used creative resources organised.

## Asset Types

- Church logos.
- Member photographs.
- Background images.
- Textures.
- Icons.
- Fonts and font references.
- Previous flyers.
- Reference designs.
- Brand materials.
- General creative resources.

## Asset Information

Each asset should support:
- Name.
- Category.
- File type.
- File size.
- Upload date.
- Preview.
- Description.
- Tags.
- Related records.

## Asset Operations

- Upload.
- Preview.
- Search.
- Download.
- Organise.
- Replace.
- Archive.

Do not silently delete files that are referenced by existing design jobs.

---

# MODULE 8: PROGRAMME AND EVENT MANAGEMENT

## Objective

Help the founder record upcoming church activities and connect them to creative responsibilities.

## Event Information

- Event title.
- Description.
- Start date.
- End date.
- Start time.
- Location.
- Event category.
- Required creative materials.
- Reference images.
- Notes.
- Status.

## Event Categories

- Sunday Service.
- Prayer Meeting.
- Conference.
- Special Programme.
- Youth Programme.
- Outreach.
- Other.

## Event Workflow

1. Founder records a programme.
2. CRELUNE adds it to the calendar.
3. Founder identifies required creative materials.
4. Relevant design jobs are created.
5. Deadlines are established.
6. Founder completes the designs.
7. Final materials are linked to the programme.
8. Programme is marked completed.

## Programme Calendar

The application should support:
- Monthly calendar.
- Weekly view.
- Upcoming events.
- Past events.
- Event details.
- Linked design jobs.

---

# MODULE 9: NOTIFICATIONS

## Objective

Ensure the founder receives useful reminders without notification overload.

## Notification Types

- Upcoming birthday.
- Birthday today.
- Upcoming programme.
- Design deadline.
- Design preparation failure.
- Export completed.
- Important system warning.

## Delivery Channels

Initial targets:
- In-app notifications.
- Mobile push notifications.
- Optional email notifications.

The actual notification provider and delivery infrastructure must be selected during architecture implementation.

## Notification Requirements

- Avoid duplicates.
- Record delivery status.
- Support notification preferences.
- Support marking notifications as read.
- Handle failed delivery.
- Respect timezone settings.
- Use a configurable reminder schedule.

Use Africa/Accra as the initial timezone setting, while allowing the owner to change it.

---

# MODULE 10: SETTINGS

## Settings Categories

### Account
- Profile.
- Email.
- Password.
- Session management.

### Application
- Theme.
- Date format.
- Timezone.
- Language preferences.

### Notifications
- Birthday reminders.
- Event reminders.
- Design deadlines.
- Push notification preferences.

### Organisation
- Organisation name.
- Logo.
- Brand colours.
- Contact information.

### Creative
- Default export format.
- Default export location.
- Registered templates.
- Affinity connection.
- Windows Agent connection.

### Storage
- Storage usage.
- File management.
- Backup settings.

---

# 6. APPLICATION NAVIGATION

## Web Navigation

Proposed primary navigation:

1. Dashboard.
2. Members.
3. Birthdays.
4. Programmes.
5. Designs.
6. Templates.
7. Assets.
8. Notifications.
9. Settings.

The design should use a clear sidebar on desktop and an appropriate compact navigation pattern on mobile-sized web screens.

## Mobile Navigation

Suggested primary destinations:

1. Home.
2. Calendar.
3. Designs.
4. Members.
5. More.

Important actions should be easy to access without navigating through several screens.

---

# 7. TECHNICAL ARCHITECTURE

The following is the recommended starting architecture. Gravity must validate dependency compatibility and justify any significant change before implementation.

## 7.1 Web Application

Recommended:
- Next.js.
- React.
- TypeScript.
- Responsive design system.
- Accessible component library.

The web application should be structured into independent feature modules.

## 7.2 Mobile Application

Recommended:
- React Native.
- Expo.
- TypeScript.

Do not build the mobile application as a WebView wrapper.

The mobile application should use the same backend and shared API contracts as the web application.

## 7.3 Backend

Recommended:
- Next.js server-side API or a clearly separated API service.
- TypeScript.
- Validated API inputs.
- Shared business logic.
- Authentication and authorization middleware.

The API architecture should support web, mobile and Windows Agent clients.

## 7.4 Database

Recommended:
- PostgreSQL.
- Prisma ORM.

Initial logical entities:

- User.
- Organisation.
- Member.
- BirthdayReminder.
- Event.
- DesignJob.
- DesignJobHistory.
- Template.
- TemplateFieldMapping.
- Asset.
- Notification.
- DeviceRegistration.
- CreativeAgent.
- CreativeJob.
- ExportRecord.
- UserPreference.

These are logical starting entities, not a final migration script.

Gravity must produce and review an entity relationship diagram before finalising the database schema.

Use appropriate unique constraints, foreign keys, indexes and deletion policies.

## 7.5 File Storage

Use private file storage.

The final provider will be selected after comparing cost, access control, reliability and integration complexity.

Requirements:
- Private storage by default.
- Secure upload and download.
- File validation.
- Image preview generation.
- Access-controlled URLs.
- File size limits.
- Backup strategy.
- Safe deletion and archival.

Never expose private member photographs through permanent public URLs.

## 7.6 Authentication

Initial account model:
- One owner account.
- Secure login.
- Password hashing.
- Session management.
- Account recovery.
- Secure logout.

No public registration.

No default or hardcoded production credentials.

## 7.7 Shared Code

Where practical, share:
- Type definitions.
- API contracts.
- Validation schemas.
- Business rules.
- Date utilities.
- Common application configuration.

Do not force the web and mobile interfaces to share presentation components when their interaction patterns differ.

---

# 8. SECURITY AND PRIVACY

Security is a foundational requirement.

## Requirements

1. All private application endpoints require authentication.
2. Server-side authorization must protect sensitive records.
3. Secrets must come from secure environment configuration.
4. No fallback production secrets.
5. Uploaded files must be validated.
6. File access must be controlled.
7. Passwords must be securely hashed.
8. Session handling must follow secure practices.
9. Input must be validated on both client and server.
10. Database operations must use safe parameterised mechanisms.
11. Sensitive information must not appear in unnecessary logs.
12. Errors must not reveal internal secrets.
13. User data must be backed up.
14. Critical operations must have appropriate audit records.

## Member Privacy

Member names, birthdays and photographs are personal information.

CRELUNE should:
- Collect only information needed for the product.
- Restrict access to the owner account.
- Avoid public member directories.
- Protect uploaded photographs.
- Allow corrections and archival.
- Avoid unnecessary retention.
- Support future consent and data-governance workflows.

The application must not assume that because a photograph or birthday is available, it can be publicly published.

---

# 9. RELIABILITY AND DATA INTEGRITY

The application must prioritise reliable records over visual convenience.

Requirements:
- Database transactions for multi-step critical operations.
- Safe retry behaviour.
- Duplicate notification prevention.
- Clear error handling.
- Reliable file upload handling.
- Consistent date calculations.
- Database backup and restore testing.
- Audit history for important operations.
- No silent data loss.
- No destructive template operations.

If an operation fails halfway through, CRELUNE should report what succeeded, what failed and what action is required.

---

# 10. DEVELOPMENT ROADMAP

Development must happen in controlled milestones.

Do not implement all modules simultaneously.

## MILESTONE 0 — PRODUCT FOUNDATION

Objectives:
- Inspect the development environment.
- Establish the repository structure.
- Define technical architecture.
- Define coding conventions.
- Define design tokens.
- Prepare database design.
- Prepare project documentation.
- Establish automated testing.
- Establish development and production environment separation.

Deliverables:
- Architecture document.
- Repository structure.
- Database ERD.
- Design system foundation.
- Technical decision records.
- Development setup instructions.

Completion criteria:
- Project builds.
- Development environment works.
- Database connection is verified.
- Tests can run.
- No unnecessary modules are implemented prematurely.

## MILESTONE 1 — AFFINITY TECHNICAL VALIDATION

Objectives:
- Validate the installed Affinity 3.3 environment.
- Validate SDK availability.
- Inspect native documents.
- Inspect PSD documents.
- Inspect document layers.
- Test safe Save As operations.
- Test PNG export.

This milestone must prove that the proposed integration is technically feasible before the product depends on it.

Deliverables:
- Environment audit.
- API capability report.
- Document inspection reports.
- Integration scripts.
- Test report.

No production template should be modified.

## MILESTONE 2 — CRELUNE WEB FOUNDATION

Objectives:
- Implement authentication.
- Establish the application shell.
- Implement navigation.
- Build the design system.
- Connect the database.
- Implement settings foundation.
- Implement dashboard structure.

Completion criteria:
- Owner can log in.
- Protected routes work.
- Application shell is responsive.
- Database operations are verified.
- Security tests pass.

## MILESTONE 3 — MEMBERS AND BIRTHDAYS

This is the first complete user-facing business module.

Objectives:
- Member registration.
- Member profiles.
- Photo upload.
- Search and filtering.
- Birthday calendar.
- Upcoming birthdays.
- Reminder scheduling.
- In-app notifications.
- Mobile push notification foundation.

Completion criteria:
- Members can be created, edited and archived.
- Birthday dates remain correct across timezone boundaries.
- Recurring birthdays calculate correctly.
- Duplicate reminders are prevented.
- Notifications are recorded.
- Mobile and web show consistent records.

## MILESTONE 4 — DESIGN MANAGEMENT

Objectives:
- Design job creation.
- Design categories.
- Design status management.
- Member and event relationships.
- Design history.
- Deadline tracking.
- Export records.

Completion criteria:
- Design jobs can be created and managed.
- Related information is linked correctly.
- Status history is preserved.
- Dashboard reflects outstanding work.

## MILESTONE 5 — TEMPLATE LIBRARY AND AFFINITY INTEGRATION

Objectives:
- Template registration.
- Template previews.
- Layer inspection.
- Field mapping.
- Working-copy generation.
- Affinity preparation workflow.
- Safe export.
- Windows Agent integration.

Completion criteria:
- Original templates remain unchanged.
- Mappings can be reviewed.
- Supported fields are populated correctly.
- Unsupported features are reported.
- Generated output can be opened and edited in Affinity.
- Exported files are verified.

## MILESTONE 6 — MOBILE APPLICATION

Objectives:
- Implement the native mobile application.
- Connect authentication.
- Connect shared API.
- Implement member and birthday views.
- Implement notifications.
- Implement design progress.
- Implement programme views.
- Support secure image uploads.

Completion criteria:
- Mobile and web share the same underlying records.
- Authentication works.
- Notifications work on supported devices.
- Mobile layouts are tested.
- Network failure and offline states are handled clearly.

## MILESTONE 7 — PROGRAMMES AND EVENTS

Objectives:
- Event registration.
- Calendar.
- Event details.
- Design requirements.
- Linked design jobs.
- Programme reminders.

Completion criteria:
- Events can be created and managed.
- Dates and times remain consistent.
- Designs can be linked to events.
- Upcoming programme information is visible on both platforms.

## MILESTONE 8 — CREATIVE ASSET LIBRARY

Objectives:
- Central asset storage.
- Asset categorisation.
- Preview generation.
- Search.
- Reuse in design jobs.
- Storage management.

Completion criteria:
- Assets are securely uploaded.
- Private access is enforced.
- Previews work.
- Referenced assets are protected from accidental deletion.

## MILESTONE 9 — QUALITY AND PRODUCTION RELEASE

Objectives:
- Full regression testing.
- Security testing.
- Performance review.
- Backup and restore verification.
- Mobile device testing.
- Desktop testing.
- Error monitoring.
- Deployment documentation.
- User documentation.

Completion criteria:
- All critical workflows pass.
- No unresolved critical security issues.
- Database backup and restore are tested.
- Production configuration is documented.
- Deployment and rollback procedures exist.

---

# 11. TESTING STRATEGY

Testing is mandatory throughout development.

## Unit Tests

Test:
- Birthday calculations.
- Reminder calculations.
- Date handling.
- Design status transitions.
- Validation rules.
- File metadata handling.
- Business logic.

## Integration Tests

Test:
- Authentication.
- Database operations.
- File uploads.
- Notification creation.
- Design job creation.
- Template mappings.
- Agent communication.

## End-to-End Tests

Test real user workflows:

### Birthday Workflow
Register member → Record birthday → Receive reminder → Create birthday design → Export → Mark published.

### Programme Workflow
Create programme → Add design requirement → Create design job → Complete design → Link output to programme.

### Template Workflow
Register template → Inspect layers → Map fields → Generate working copy → Open in Affinity → Export → Verify original unchanged.

## Regression Testing

Every milestone must preserve previously working functionality.

Do not remove working features to make a new implementation easier.

---

# 12. USER EXPERIENCE REQUIREMENTS

CRELUNE should feel polished and predictable.

## Interaction Rules

- Use clear labels.
- Avoid confusing icons.
- Provide confirmation for destructive operations.
- Support undo where appropriate.
- Show progress for longer operations.
- Show helpful empty states.
- Display useful error messages.
- Keep important actions accessible.
- Maintain consistent spacing.
- Support keyboard navigation on web.
- Respect mobile safe areas.
- Avoid unnecessarily complicated workflows.

## Responsive Requirements

Web:
- Desktop-first management experience.
- Tablet compatibility.
- Mobile web fallback.

Mobile:
- Native application navigation.
- Touch-friendly controls.
- Optimised forms.
- Image selection and upload.
- Push notification support.

---

# 13. PERFORMANCE REQUIREMENTS

Initial targets:
- Fast initial application load.
- Efficient database queries.
- Paginated large lists.
- Optimised image previews.
- Background processing for longer operations.
- No unnecessary repeated network requests.
- Graceful handling of slow connections.

Do not block the main user interface while generating previews or processing files.

---

# 14. OUT OF SCOPE FOR THE FIRST RELEASE

These features must not distract from the initial personal product:

- Multi-user team management.
- Team invitations.
- Team chat.
- Public member registration.
- Public-facing church website.
- Full church management or accounting.
- Automated social media publishing.
- Full video editing.
- Audio production.
- Complex multi-organisation SaaS billing.
- AI-generated final artwork without approval.
- Automatic publication of creative designs.

These can be evaluated in future product versions.

---

# 15. SUCCESS METRICS

CRELUNE should be measured by practical improvements.

Initial success indicators:
- No forgotten birthdays due to missing reminders.
- Less time spent searching for templates.
- Less time spent preparing repetitive birthday designs.
- All design jobs have visible statuses.
- Upcoming events are easy to identify.
- Creative assets are organised.
- Original templates remain protected.
- Mobile and desktop records stay synchronised.
- The founder can manage daily creative responsibilities from one system.

---

# 16. INSTRUCTIONS FOR GOOGLE ANTIGRAVITY

You are implementing CRELUNE, a real software product.

Treat this document as the primary product specification.

## Your Role

Act as a senior software architect, senior full-stack engineer, mobile engineer, desktop integration engineer, security engineer and quality assurance engineer.

You are expected to make sound technical decisions, document them and implement production-quality functionality.

## Mandatory Rules

1. Read this complete specification before implementation.
2. Inspect the existing repository before changing files.
3. Do not assume the repository is empty.
4. Do not replace working architecture without justification.
5. Do not create fake functionality or placeholder buttons presented as complete features.
6. Do not invent SDK methods.
7. Verify official Affinity documentation before integration.
8. Do not modify original templates.
9. Do not expose secrets in source code.
10. Do not use real member information in automated tests.
11. Do not use destructive database operations without explicit approval.
12. Do not silently alter production data.
13. Do not skip testing.
14. Do not claim that an operation passed when it has not been executed.
15. Document every significant architectural decision.
16. Preserve a working Git history.
17. Keep the implementation modular.
18. Avoid overengineering features that are not in the current milestone.

## Implementation Method

For each milestone:

1. Read the relevant requirements.
2. Inspect the current project.
3. Create an implementation plan.
4. Identify risks and dependencies.
5. Implement the milestone.
6. Run automated tests.
7. Run builds.
8. Perform relevant manual verification.
9. Inspect for regressions.
10. Document completed work.
11. Report incomplete work and known limitations.
12. Wait for approval before moving into a milestone that requires a new major scope or external commitment.

## Required Documentation Files

Maintain:

- README.md
- docs/PRODUCT_MASTER_SPECIFICATION.md
- docs/ARCHITECTURE.md
- docs/DATABASE_DESIGN.md
- docs/DESIGN_SYSTEM.md
- docs/SECURITY.md
- docs/DEVELOPMENT_ROADMAP.md
- docs/TECHNICAL_DECISIONS.md
- docs/TESTING_STRATEGY.md
- docs/CHANGELOG.md

Add milestone-specific reports under:

docs/milestones/

Update the master specification when an approved product decision changes.

## Reporting Format

At the end of each milestone report:

- Milestone name.
- Objectives.
- Features implemented.
- Files created or modified.
- Database changes.
- Tests executed.
- Build results.
- Security observations.
- Known issues.
- Outstanding work.
- Acceptance criteria.
- Whether the milestone is genuinely complete.

Never label a milestone complete merely because the code compiles.

---

# 17. INITIAL EXECUTION INSTRUCTION

Do not begin implementing every module immediately.

Start with a complete repository and environment audit.

Then:

1. Confirm the available development tools.
2. Inspect the existing project.
3. Confirm Affinity 3.3 and its supported integration capabilities.
4. Propose the final technical architecture.
5. Prepare the database ERD.
6. Prepare the project folder structure.
7. Identify external services and their costs.
8. Identify unresolved product decisions.
9. Produce a milestone implementation plan.

Do not start destructive operations or modify existing user data.

Present the audit findings and proposed implementation plan before proceeding with major implementation.

**The immediate objective is to establish a reliable foundation for CRELUNE, not to rush into building a large collection of unfinished features.**

---

# END OF CRELUNE PRODUCT MASTER SPECIFICATION