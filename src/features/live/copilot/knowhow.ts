// Know-how de consultor SAP ABAP para el Copiloto (PRP-004, fase 1, 10 nov 2026). SOLO SERVIDOR:
// es texto largo y no debe viajar al navegador (profile.ts sí se usa en el navegador).
//
// Por qué: el Copiloto solo sabía lo que traen la reunión y los Documentos, más lo que el modelo
// recuerda. Con este paquete contesta las preguntas generales de SAP como un consultor actual
// («¿qué BAdI uso?», «¿cómo depuro un IDoc en 51?», «¿qué cambia en S/4?»), sin inventar datos
// del proyecto. Va en el caché de Gemini de cada reunión (lib/meetingContext), así que no suma
// tiempo a la primera respuesta; en el respaldo de OpenRouter va en el prompt.
//
// Escrito con palabras propias (no copia material de cursos ni de SAP). Para agregar temas que el
// Copiloto no supo contestar en reuniones reales (fase 3), se edita aquí y se sube la versión.
import { COPILOT_INSTRUCTIONS } from './profile'

export const KNOWHOW_VERSION = '2026-11-10'

export const SAP_ABAP_KNOWHOW = `SAP ABAP CONSULTANT KNOW-HOW (general reference, version ${KNOWHOW_VERSION})

HOW TO USE THIS REFERENCE
- This is general SAP knowledge, not project data. Project facts (tickets, custom Z/Y objects, dates, estimates, status, who does what, system names) come ONLY from the meeting transcript and the reference documents.
- Use it to understand the question and to answer general SAP questions like a senior consultant: concrete transactions, standard objects and steps.
- Release matters. If an answer depends on the SAP release, support package or edition (ECC vs S/4HANA on-premise vs S/4HANA Cloud Private/Public Edition vs BTP ABAP environment), say so briefly and offer to confirm it in the system or with a quick check.
- Never invent SAP Note or KBA numbers, exact release dates, or names of standard objects you are not sure exist. Prefer "there is a standard BAdI for that; I'll confirm the exact name in SE18" over guessing.

1. LANDSCAPE AND RELEASES
- ECC 6.0 (SAP Business Suite 7, NetWeaver/ABAP 7.0x-7.50, any database). Mainstream maintenance ends at the end of 2027; optional extended maintenance runs to the end of 2030. Many customers are converting to S/4HANA.
- S/4HANA on-premise: releases 1511, 1610, 1709, 1809, 1909, 2020, 2021, 2022, 2023; since 2023 the cadence is about every two years with a longer maintenance window. ABAP Platform versions map roughly to ABAP 7.53 (1809), 7.54 (1909), 7.55 (2020), 7.56 (2021), 7.57 (2022), 7.58 (2023).
- S/4HANA Cloud Private Edition (usually through RISE): same code line as on-premise, customer-specific system, classic ABAP still possible but clean core is expected.
- S/4HANA Cloud Public Edition: multi-tenant SaaS; only key-user extensibility, ABAP Cloud developer extensibility and side-by-side extensions; no modifications, no classic SAP GUI development.
- SAP BTP ABAP environment ("Steampunk"): ABAP Cloud only, used for side-by-side apps and extensions. "Embedded Steampunk" = ABAP Cloud inside S/4HANA (2022+ on-premise/private, and public edition).
- Tools: SAP GUI transactions for classic objects; ABAP Development Tools (ADT, Eclipse) are required for CDS, RAP, AMDP and ABAP Cloud. SE80 still works for classic objects.

2. WHAT CHANGED IN S/4HANA (SIMPLIFICATIONS THAT AFFECT CUSTOM CODE)
- Business Partner is mandatory for customers and vendors (transaction BP; Customer/Vendor Integration, CVI). KNA1/LFA1 still exist and are filled through BP; XD01/XK01 style transactions redirect to BP.
- Universal Journal: table ACDOCA holds FI and CO line items together. BSEG still exists for the entry view; old index and totals tables (BSIS, BSAS, BSID, BSAD, BSIK, BSAK, GLT0, COEP totals) became compatibility views. Reading them still works; writing to them directly is a problem.
- Inventory: MATDOC replaces MKPF/MSEG as the storage of material documents; MKPF/MSEG are served by compatibility views. Stock aggregates are calculated on the fly.
- Material number can be 40 characters (field length extension); watch fixed-length string handling and interfaces.
- SD: document status fields moved from VBUK/VBUP into the header and item tables (VBAK/VBAP, LIKP/LIPS, VBRK/VBRP). Pricing conditions moved from KONV to PRCD_ELEMENTS. Credit management moved to FSCM credit management (UKM_* objects). Rebates moved to condition contract settlement. Output management is the new BRF+-based framework (NAST/NACE still possible for some documents).
- Others: Material Ledger and actual costing are always active; new Asset Accounting; MRP Live (MD01N); advanced ATP; cash management replaced by SAP Cash Management; many obsolete transactions have Fiori app successors.
- How to assess: the Simplification Item Catalog and the simplification item check (SI-Check, report /SDF/RC_START_CHECK), SAP Readiness Check, and custom code analysis with ATC using the S/4HANA readiness check variants (often run on a central ATC system, with the Custom Code Migration app). Usage data from SCMON/SUSG helps decide what custom code to drop.
- Conversion approaches: brownfield (system conversion with SUM, often with DMO when the database changes), greenfield (new implementation), and selective data transition ("bluefield", usually with partner tools). SPDD/SPAU adjust dictionary objects and modifications after the upgrade; SPAU_ENH handles enhancements.

3. MODERN ABAP LANGUAGE (7.40 AND LATER)
- Inline declarations: DATA(x) = ..., FIELD-SYMBOL(<fs>), in SELECT INTO TABLE @DATA(itab).
- Constructor expressions: VALUE, NEW, CONV, CORRESPONDING (with MAPPING/EXCEPT), REF, CAST, EXACT, REDUCE, FILTER (needs a sorted or hashed key), COND and SWITCH. String templates with |...| and embedded expressions and formatting options.
- Table expressions: itab[ key = value ] raises CX_SY_ITAB_LINE_NOT_FOUND if missing; use OPTIONAL or DEFAULT, or line_exists( ) and line_index( ). LOOP AT ... GROUP BY for grouping. Secondary keys on internal tables. Prefer SORTED/HASHED tables for lookups in loops.
- ABAP SQL (strict mode): host variables with @, comma-separated field lists, SQL expressions (CASE, CAST, COALESCE, arithmetic, string functions), aggregates, CTEs with WITH, UNION in newer releases, window functions in newer releases, joins on CDS views, client handling with USING CLIENT instead of CLIENT SPECIFIED.
- FOR ALL ENTRIES: always check that the driver table is not empty (empty = selects all rows), it removes duplicates, and it is often slower than a JOIN or a range on HANA.
- Exceptions: class-based (CX_STATIC_CHECK, CX_DYNAMIC_CHECK, CX_NO_CHECK under CX_ROOT); RAISE EXCEPTION NEW ...; TRY / CATCH / CLEANUP; RESUMABLE and RETRY exist. Message classes in SE91; T100 messages can be raised as exceptions with IF_T100_MESSAGE.
- Object orientation: interfaces and dependency injection make code testable; avoid static-heavy designs; use factories for test doubles.
- Clean ABAP: SAP publishes an open "Clean ABAP" style guide (meaningful names, small methods, no Hungarian notation required, prefer exceptions over return codes, avoid obsolete statements like MOVE-CORRESPONDING into header lines or FORM routines in new code).

4. CDS (CORE DATA SERVICES)
- Two generations: CDS DDIC-based views (DEFINE VIEW with an SQL view name; obsolete for new development) and CDS view entities (DEFINE VIEW ENTITY, from ABAP 7.55 / S/4HANA 2020). New development uses view entities.
- Building blocks: associations and path expressions, compositions (for RAP), parameters, calculated fields, CASE, CAST, aggregations, unions, table functions implemented with AMDP, virtual elements (calculated in ABAP), extensions (EXTEND VIEW ENTITY) and metadata extensions for UI annotations.
- Access control: DCL roles (DEFINE ROLE) with @AccessControl.authorizationCheck; they apply when the view is read with ABAP SQL (not when SAP internal code bypasses them).
- Annotations: @ObjectModel, @Semantics, @UI (Fiori elements), @Analytics (embedded analytics, analytical queries), @Consumption, @Search, @EndUserText. @OData.publish was the old way to expose a view; RAP service bindings replaced it.
- Virtual Data Model (VDM) in S/4: I_* interface/basic views, C_* consumption views, P_* private views, R_* views used by RAP BOs, A_* for remote APIs. Use released views (C1 contract) instead of reading SAP tables directly in ABAP Cloud.
- How to find a released view: ADT "API State" / Properties tab, the "Released Objects" tree in ADT, the SAP Business Accelerator Hub (api.sap.com), and the Cloudification Repository viewer.

5. AMDP (ABAP MANAGED DATABASE PROCEDURES)
- A class that implements IF_AMDP_MARKER_HDB; a method declared BY DATABASE PROCEDURE FOR HDB LANGUAGE SQLSCRIPT (OPTIONS READ-ONLY, USING the tables/views it reads) or BY DATABASE FUNCTION FOR TABLE FUNCTION for CDS table functions.
- Use it when the logic cannot be expressed in ABAP SQL or CDS and must run on the database (heavy calculations, procedures over large volumes). Prefer ABAP SQL/CDS first: easier to maintain and portable.
- Debug with AMDP breakpoints in ADT. AMDP is HANA-specific; in ABAP Cloud only released objects can be used inside it (check the release for details).

6. RAP (ABAP RESTFUL APPLICATION PROGRAMMING MODEL)
- A business object = a CDS root view entity with child entities (compositions), plus a behavior definition (BDEF) and a behavior implementation (behavior pool, a global class FOR BEHAVIOR OF the root).
- Implementation types: managed (framework does create/update/delete and save), managed with unmanaged save or with additional save (custom persistence or side effects), unmanaged (wrap existing logic, often BAPIs or legacy function modules). Draft-enabled BOs keep draft tables and provide Edit, Activate, Discard and Resume.
- Behavior features: determinations (on modify / on save), validations (on save), actions and functions, feature control (static, instance, global), authorization control (global and instance), early or late numbering, ETag / total ETag for optimistic locking, side effects for the UI, business events (RAP events for event-driven integration).
- Handler classes: local classes lhc_<entity> (interaction phase) and lsc_<bo> saver class (save sequence: finalize, check_before_save, adjust_numbers, save, cleanup). Results come back through FAILED, MAPPED and REPORTED.
- EML (Entity Manipulation Language): READ ENTITIES, MODIFY ENTITIES (CREATE, UPDATE, DELETE, EXECUTE action), COMMIT ENTITIES, IN LOCAL MODE inside the BO's own implementation (skips authorization and feature control).
- Service layer: projection views and projection BDEF, service definition (EXPOSE), service binding (OData V2 or V4, UI or Web API). Preview in ADT with Fiori elements.
- Released RAP BOs ("RAP facades") such as the sales order or product APIs let ABAP Cloud code change SAP data through EML instead of BAPIs.

7. ABAP CLOUD AND CLEAN CORE
- ABAP Cloud = the development model with ABAP language version "ABAP for Cloud Development": only released APIs, CDS and RAP, ADT only, no SAP GUI dynpros, no direct access to unreleased SAP tables, no modifications. Release contracts: C0 (stable extension points), C1 (use in cloud development and key user apps), C2 (remote APIs), C3 (configuration content), C4 (released for ABAP-managed database objects).
- Three-tier model for S/4 on-premise and private edition: tier 1 = ABAP Cloud; tier 2 = customer-built wrappers around unreleased SAP APIs, released by the customer for tier 1 (cloud API enablement); tier 3 = classic ABAP. SAP later framed the same idea as clean core extensibility levels (A: only released APIs and extension points; B: classic, documented APIs considered stable; C: internal SAP objects, upgrade risk; D: modifications, direct writes to SAP tables, implicit enhancements). The exact naming and ATC checks depend on the release, so confirm which framework the customer's governance uses.
- How to check if an object is released: ADT API State, the Cloudification Repository (public list of released objects and their successors for unreleased ones), and ATC checks for cloud readiness / clean core. For unreleased objects, the repository often names a released successor.
- Key user extensibility (Fiori apps): Custom Fields (and the older Custom Fields and Logic), Custom Logic (cloud BAdIs), Custom CDS Views, Custom Business Objects, custom analytical queries.
- Developer extensibility: ABAP Cloud in the same stack (embedded Steampunk). Side-by-side: separate app on BTP (ABAP environment or CAP) talking through released APIs and events.

8. SAP BTP AND INTEGRATION SERVICES
- BTP ABAP environment, CAP (Node.js/Java) for side-by-side apps, SAP Build (Apps, Process Automation, Work Zone), SAP HANA Cloud.
- Integration Suite: Cloud Integration (CPI iFlows), API Management, Open Connectors, Integration Advisor, Event Mesh / Advanced Event Mesh for events from S/4 (business events, RAP events).
- Connectivity: SAP Cloud Connector for on-premise systems, BTP destinations, principal propagation. In cloud ABAP systems, outbound and inbound calls use communication scenarios, communication systems, communication arrangements and communication users.
- Identity: SAP Cloud Identity Services (IAS/IPS), XSUAA in Cloud Foundry.

9. ENHANCEMENTS (HOW TO CHANGE STANDARD BEHAVIOR)
- Order of preference: configuration first; then released extension points (cloud BAdIs, key user extensibility); then classic BAdIs and enhancement framework; modifications only as a last resort.
- User exits: customer exits defined in SMOD and implemented in CMOD projects (function exits EXIT_..., includes ZX...); in SD the classic form-based user exits in includes like MV45AFZZ (sales order) need an access key because they are technically modifications.
- Classic BAdIs: definition SE18, implementation SE19. To find which BAdIs a transaction calls, set a breakpoint in method GET_INSTANCE of class CL_EXITHANDLER and run the transaction.
- New (kernel) BAdIs: part of enhancement spots, called with GET BADI / CALL BADI; find them with a debugger breakpoint at those ABAP statements, or by searching the enhancement spots of the package. Filters decide which implementation runs.
- Enhancement framework: implicit enhancement points (start/end of function modules, methods, forms; risky in upgrades and considered not clean core), explicit enhancement points and sections, class enhancements (pre-, post- and overwrite-methods).
- FI: Business Transaction Events (BTE, transaction FIBF, "Open FI"), validations and substitutions (GGB0/GGB1, OB28/OBBH). SD/MM: requirement, copy control and pricing routines (VOFM, need an access key), output determination.
- Appends: append structures and customer includes add fields to standard tables; in S/4 cloud-ready approach use the Custom Fields app, which also propagates fields to CDS, OData and UIs.
- Upgrades: modifications are reconciled in SPAU, dictionary changes in SPDD, enhancements in SPAU_ENH.

10. INTERFACES
- IDocs / ALE: message type, basic type and extension (WE30/WE31 for types and segments, WE81/WE82 for message types), logical systems (BD54, SALE), distribution model (BD64), partner profiles (WE20), ports (WE21), process codes (WE41 outbound, WE42 inbound), change pointers (BD50/BD52, BD21 to process). Monitor with WE02/WE05, test inbound with WE19, reprocess with BD87. Common statuses: outbound 03 = passed to port (30 = ready, 02/29 = errors); inbound 64 = ready, 51 = application error, 53 = posted successfully, 68 = no further processing. For status 51: read the status messages, test with WE19 in the foreground or debug the inbound function module (IDOC_INPUT_...), then reprocess with BD87.
- RFC: destinations in SM59; synchronous RFC, asynchronous, transactional (tRFC, monitor SM58), queued (qRFC, SMQ1 outbound / SMQ2 inbound), and bgRFC as the modern successor (SBGRFCCONF, SBGRFCMON). Remote-enabled function modules; trusted RFC.
- BAPIs: browse with transaction BAPI; always read the RETURN table and call BAPI_TRANSACTION_COMMIT (or ROLLBACK) yourself; many BAPIs do not commit.
- SOAP / proxies: Enterprise Services, proxies generated in SPROXY, configuration in SOAMANAGER; SAP PI/PO or Integration Suite in the middle.
- OData: SAP Gateway Service Builder SEGW for V2 (DPC_EXT/MPC_EXT classes), register in /IWFND/MAINT_SERVICE, test with /IWFND/GW_CLIENT, errors in /IWFND/ERROR_LOG and /IWBEP/ERROR_LOG, cache cleanup with /IWFND/CACHE_CLEANUP. OData V4 comes mainly from RAP service bindings (admin in /IWFND/V4_ADMIN). To debug a Fiori or OData call, set an external (user) breakpoint for the calling user in the backend implementation.
- REST/HTTP from ABAP: CL_HTTP_CLIENT (classic, with SM59 destinations) and CL_WEB_HTTP_CLIENT_MANAGER (ABAP Cloud, with communication arrangements). JSON with /UI2/CL_JSON (classic), XCO JSON library (cloud) or CALL TRANSFORMATION id. Application Interface Framework (AIF) is SAP's monitoring and error-handling layer for interfaces.

11. FORMS AND OUTPUT
- SAPscript (SE71, old), Smart Forms (transaction SMARTFORMS; get the generated function module name with SSF_FUNCTION_MODULE_NAME), Adobe Forms / Interactive Forms by Adobe (transaction SFP: interface + form + layout in Adobe LiveCycle Designer; at runtime FP_JOB_OPEN, FP_FUNCTION_MODULE_NAME, call the generated module, FP_JOB_CLOSE). Adobe Forms need Adobe Document Services (ADS); if forms fail to render, check the ADS connection (for example the standard test reports for ADS) before debugging the form.
- Classic output control: condition records and NAST (NACE). S/4HANA output management: BRF+-based output parameter determination, Fiori apps for form templates, and the SAP Forms service by Adobe in the cloud.
- Spool: SP01/SP02; printers in SPAD.

12. REPORTS AND UI
- ALV: CL_SALV_TABLE for read-only lists (simple and modern), CL_GUI_ALV_GRID for editable grids, REUSE_ALV_* function modules in old code. Selection screens, variants, background execution with SM36/SM37.
- Fiori: Fiori elements (List Report, Object Page, Worklist, Analytical List Page) driven by CDS annotations; freestyle SAPUI5 when the floorplan does not fit; Fiori launchpad (/UI2/FLP), catalogs and spaces/pages; the Fiori Apps Reference Library shows standard apps.
- Embedded analytics: analytical CDS queries, Query Browser, custom analytical queries.

13. DEBUGGING, LOGS AND PERFORMANCE
- Where to look first: ST22 (short dumps), SM21 (system log), SLG1 (application log, BAL), SM37 (job log), SM13 (failed update requests), SM12 (lock entries), SM50/SM66 (work processes), SM58/SMQ1/SMQ2 (RFC queues), ST01/STAUTHTRACE and SU53 (authorizations).
- Debugger: /h, session and external (user) breakpoints, breakpoints at statements and exceptions, watchpoints, layer-aware debugging, debugger scripting, update task and system debugging (settings), debugging a background job via SM37 (JDBG) or SM50.
- Traces: ST05 (SQL, buffer, RFC, HTTP traces), SAT (runtime analysis), ST12 (combined), ADT ABAP profiler, SQL Monitor (SQLM) and the SQL Performance Tuning Worklist (SWLT) for productive hot spots, ST04/DBACOCKPIT for the database.
- Performance on HANA: push logic to the database (ABAP SQL expressions, CDS, AMDP) instead of loops; no SELECT inside loops; select only the needed columns; use joins or ranges instead of nested selects; watch FOR ALL ENTRIES; use SORTED/HASHED internal tables; table buffering for small customizing tables; parallelize big jobs (aRFC with server groups, bgRFC, SPTA framework); check indexes only after the statement itself is right.

14. TRANSPORTS AND QUALITY
- Transports: SE09/SE10 (requests and tasks), STMS (import queue, routes), transport of copies for testing, CTS+ for non-ABAP objects, gCTS (git-enabled CTS), abapGit for open-source style version control, change control with Solution Manager ChaRM or SAP Cloud ALM.
- Quality: ATC (ABAP Test Cockpit) with check variants, priorities and exemptions, often from a central ATC system; Code Inspector (SCI); Code Vulnerability Analyzer for security checks.
- ABAP Unit: test classes FOR TESTING with RISK LEVEL and DURATION; test doubles with CL_ABAP_TESTDOUBLE, the ABAP SQL test double framework (CL_OSQL_TEST_ENVIRONMENT), the CDS test double framework (CL_CDS_TEST_ENVIRONMENT), TEST-SEAM / TEST-INJECTION for legacy code. Run with Ctrl+Shift+F10 in ADT; coverage in ADT.
- Code review: naming conventions, error handling, performance patterns, authorization checks, no hardcoded values (use customizing or constants), messages in message classes, translations.

15. SECURITY AND AUTHORIZATIONS
- AUTHORITY-CHECK OBJECT with the right fields and check SY-SUBRC; roles in PFCG; proposals in SU24; missing authorizations in SU53; traces in STAUTHTRACE/ST01. Common objects: S_TCODE, S_DEVELOP, S_RFC, S_TABU_DIS/S_TABU_NAM, plus application objects (for example sales area or company code checks).
- CDS access control (DCL) and RAP authorization control in modern code.
- Avoid dynamic SQL injection (validate dynamic WHERE parts, CL_ABAP_DYN_PRG), avoid checks on hardcoded user names, respect client handling.

16. WORKFLOW AND DATA MIGRATION
- SAP Business Workflow: builder SWDD, logs SWI1/SWIA, event trace SWEL/SWELS, event linkage SWETYPV, customizing check SWU3. S/4HANA flexible workflow is configured with Fiori apps (Manage Workflows) for supported documents. SAP Build Process Automation for side-by-side workflows.
- Data migration: S/4HANA Migration Cockpit (Fiori app "Migrate Your Data"; object modeler LTMOM in older releases), staging tables or files, direct transfer from SAP sources; BAPIs and IDocs for custom loads; batch input (SHDB recorder, CALL TRANSACTION) for legacy cases; LSMW is old and not the recommended tool in S/4.

17. HOW AN SAP ABAP PROJECT WORKS
- Object types are usually grouped as RICEFW/FRICEW: forms, reports, interfaces, conversions, enhancements, workflows.
- Flow: functional spec (from the functional consultant) -> technical spec (ABAP) -> build -> unit test -> functional/integration tests (FUT/SIT) -> user acceptance (UAT) -> transports to production -> cutover -> hypercare.
- Questions a good ABAP consultant asks about a requirement: trigger and frequency, inputs and outputs, selection criteria and volumes, error handling and who monitors it, authorizations, languages and units/currencies, reuse of standard (BAPI, released API, existing Z object), test data and test cases, dependencies on other teams, transport and cutover steps.
- Estimates depend on complexity, number of objects, interfaces and testing effort; do not give a number in the meeting unless the transcript already has one; offer to come back with it.
- Defect handling: reproduce, check dumps/logs, debug to the root cause, fix, regression test, document in the defect.

18. QUICK HOW-TOS (SHORT, SAY-ABLE ANSWERS)
- Which BAdI to use for a sales order check on save: look for standard BAdIs first (SE18 search, breakpoint in CL_EXITHANDLER=>GET_INSTANCE or at GET BADI while saving in VA01/VA02); classic SD user exits in MV45AFZZ (for example the save preparation exit) are the fallback and need an access key; in S/4 cloud-ready code, check the released BAdIs for sales documents in the Custom Logic app.
- Inbound IDoc in status 51: open it in WE02, read the status message, fix the master data or mapping, test in WE19 in foreground or debug the inbound function module, reprocess with BD87.
- A background job failed: SM37 job log, then ST22 for a dump at that time, SLG1 for the application log, and rerun in foreground or debug with JDBG.
- Is this object released for ABAP Cloud: check API State in ADT or the Cloudification Repository; if it is not released, look for the successor listed there or a released CDS view / RAP BO / BAdI.
- Why is a report slow: ST05 or SAT on a representative run, find the expensive statement, push the logic to the database, remove selects in loops, use proper keys and internal table types.
- How to add a custom field end to end in S/4: Custom Fields app (business context, UIs, reports, APIs) instead of a manual append when the scenario is supported.
- How to call an external REST API from ABAP: an SM59 destination (or a communication arrangement in ABAP Cloud), an HTTP client, JSON serialization, and proper error handling and logging (SLG1).
- Debug a Fiori app call: find the OData service in the browser network tab or /IWFND/ERROR_LOG, set an external breakpoint for your user in the backend class, and replay with /IWFND/GW_CLIENT if needed.
`

/** Instrucciones del Copiloto + know-how: lo que va en el caché de la reunión y en el respaldo. */
export const COPILOT_SYSTEM = `${COPILOT_INSTRUCTIONS}\n\n${SAP_ABAP_KNOWHOW}`
