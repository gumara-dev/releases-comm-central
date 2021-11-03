/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const EXPORTED_SYMBOLS = ["CalStorageItemModel"];

const { cal } = ChromeUtils.import("resource:///modules/calendar/calUtils.jsm");
const { CAL_ITEM_FLAG, newDateTime } = ChromeUtils.import(
  "resource:///modules/calendar/calStorageHelpers.jsm"
);
const { CalStorageModelBase } = ChromeUtils.import(
  "resource:///modules/calendar/CalStorageModelBase.jsm"
);

const { XPCOMUtils } = ChromeUtils.import("resource://gre/modules/XPCOMUtils.jsm");

XPCOMUtils.defineLazyModuleGetters(this, {
  CalAlarm: "resource:///modules/CalAlarm.jsm",
  CalAttachment: "resource:///modules/CalAttachment.jsm",
  CalAttendee: "resource:///modules/CalAttendee.jsm",
  CalEvent: "resource:///modules/CalEvent.jsm",
  CalRecurrenceInfo: "resource:///modules/CalRecurrenceInfo.jsm",
  CalRelation: "resource:///modules/CalRelation.jsm",
  CalTodo: "resource:///modules/CalTodo.jsm",
});

const cICL = Ci.calIChangeLog;
const USECS_PER_SECOND = 1000000;
const DEFAULT_START_TIME = -9223372036854776000;

// endTime needs to be the max value a PRTime can be
const DEFAULT_END_TIME = 9223372036854776000;

/**
 * CalItemQueue is used to buffer fetched items before dispatching to a listener.
 */
class CalItemQueue {
  /**
   * The total number of items ever added to the queue.
   * @type {number}
   */
  totalCount = 0;

  /**
   * An array containing the pending items added to the queue.
   * @type {calIItemBase[]}
   */
  pendingItems = [];

  /**
   * Called with the flushed items from the queue.
   * @type {GetItemsListener}
   */
  listener = null;

  /**
   * The total maximum number of items that can be added. If this is reached,
   * any further attempts to add items will be ignored.
   * @type {number}
   */
  maxTotalItems = null;

  /**
   * The maximum number of items to queue up before automatically flushing.
   * @type {number}
   */
  maxQueueSize = null;

  /**
   * @param {GetItemsListener} listener
   * @param {number} maxTotalItems
   * @param {number} maxQueueSize
   */
  constructor(listener, maxTotalItems = 0, maxQueueSize = 10) {
    this.listener = listener;
    this.maxTotalItems = maxTotalItems;
    this.maxQueueSize = maxQueueSize;
  }

  /**
   * Indicates whether the maximum number of items have been to the queue after
   * which no more will be allowed.
   * @type {number}
   */
  get maxTotalItemsReached() {
    // Ideally, maxTotalItems=0 should mean no items are returned but 0 is used
    // elsewhere to indicate the absence of a limit.
    return this.maxTotalItems && this.pendingItems.length >= this.maxTotalItems;
  }

  /**
   * Adds one or more items to the end of the queue.
   * @param {calItemBase|calItemBase[]} items
   */
  add(items) {
    if (this.maxTotalItemsReached) {
      return;
    }

    items = Array.isArray(items) ? items : [items];
    this.pendingItems = this.pendingItems.concat(items);
    this.totalCount += items.length;

    if (this.pendingItems.length >= this.maxQueueSize) {
      this.flush();
    }
  }

  /**
   * Implemented by child classes to pass the correct nsIID to the listener.
   *
   * @param {calItemBase[]} items
   */
  invokeListener(items) {}

  /**
   * Flushes the pending items passing them to the internal listener.
   */
  flush() {
    this.invokeListener(this.pendingItems);
    this.pendingItems = [];
  }
}

/**
 * CalEventQueue is for events.
 */
class CalEventQueue extends CalItemQueue {
  invokeListener(items) {
    this.listener(items, Ci.calIEvent);
  }
}

/**
 * CalTodoQueue is for todos.
 */
class CalTodoQueue extends CalItemQueue {
  invokeListener(items) {
    this.listener(items, Ci.calITodo);
  }
}

/**
 * CalStorageItemModel provides methods for manipulating item data.
 */
class CalStorageItemModel extends CalStorageModelBase {
  /**
   * @type {calISchedulingSupport}
   */
  _schedulingSupport =
    (this.calendar.superCalendar.supportsScheduling &&
      this.calendar.superCalendar.getSchedulingSupport()) ||
    null;

  /**
   * Update the item passed.
   *
   * @param {calIItemBase} item - The newest version of the item.
   * @param {calIItemBase} oldItem - The previous version of the item.
   */
  async updateItem(item, olditem) {
    cal.ASSERT(!item.recurrenceId, "no parent item passed!", true);
    await this.deleteItemById(olditem.id, true);
    await this.addItem(item);
  }

  /**
   * Object containing the parameters for executing a DB query.
   * @typedef {Object} CalStorageQuery
   * @property {CalStorageQueryFilter} filter
   * @property {calIDateTime} rangeStart
   * @property {calIDateTime?} rangeEnd
   * @property {number} count
   */

  /**
   * Object indicating types and state of items to return.
   * @typedef {Object} CalStorageQueryFilter
   * @property {boolean} wantUnrespondedInvitations
   * @property {boolean} wantEvents
   * @property {boolean} wantTodos
   * @property {boolean} asOccurrences
   * @property {boolean} wantOfflineDeletedItems
   * @property {boolean} wantOfflineCreatedItems
   * @property {boolean} wantOfflineModifiedItems
   * @property {boolean} itemCompletedFilter
   * @property {boolean} itemNotCompletedFilter
   */

  /**
   * A function that receives the result of a query to getItems().
   * @callback GetItemsListener
   * @param {calIItemBase[]] items
   * @param {nsIIDRef} itemType
   */

  /**
   * Retrieves one or more items from the database based on the query provided.
   * See the definition of CalStorageQuery for valid query parameters.
   * @param {CalStorageQuery} query
   * @param {GetItemsListener} listener
   */
  async getItems(query, listener) {
    let eventCount = 0;
    let { filters, count } = query;
    if (filters) {
      if (filters.wantEvents) {
        eventCount += await this.getEvents(query, listener);
      }

      count = count && count - eventCount;
      if (filters.wantTodos && (!count || count > 0)) {
        await this.getTodos({ ...query, count }, listener);
      }
    }
  }

  /**
   * Queries the database for calIEvent records passing them to the provided
   * listener.
   * @param {CalStorageQuery} query
   * @param {GetItemsListener} listener
   *
   * @returns {number} The number of items retrieved.
   */
  async getEvents(query, listener) {
    let { filters, rangeStart, rangeEnd } = query;
    let startTime = DEFAULT_START_TIME;
    let endTime = DEFAULT_END_TIME;

    if (rangeStart) {
      startTime = rangeStart.nativeTime;
    }
    if (rangeEnd) {
      endTime = rangeEnd.nativeTime;
    }

    let params; // stmt params
    let requestedOfflineJournal = null;

    if (filters.wantOfflineDeletedItems) {
      requestedOfflineJournal = cICL.OFFLINE_FLAG_DELETED_RECORD;
    } else if (filters.wantOfflineCreatedItems) {
      requestedOfflineJournal = cICL.OFFLINE_FLAG_CREATED_RECORD;
    } else if (filters.wantOfflineModifiedItems) {
      requestedOfflineJournal = cICL.OFFLINE_FLAG_MODIFIED_RECORD;
    }

    let queue = new CalEventQueue(listener, query.count);

    // first get non-recurring events that happen to fall within the range
    //
    try {
      this.db.prepareStatement(this.statements.mSelectNonRecurringEventsByRange);
      params = this.statements.mSelectNonRecurringEventsByRange.params;
      params.range_start = startTime;
      params.range_end = endTime;
      params.start_offset = rangeStart ? rangeStart.timezoneOffset * USECS_PER_SECOND : 0;
      params.end_offset = rangeEnd ? rangeEnd.timezoneOffset * USECS_PER_SECOND : 0;
      params.offline_journal = requestedOfflineJournal;

      await this.db.executeAsync(this.statements.mSelectNonRecurringEventsByRange, async row => {
        let event = await this.getEventFromRow(row);
        queue.add(this._expandOccurrences(event, startTime, rangeStart, rangeEnd, filters));
      });
    } catch (e) {
      this.db.logError("Error selecting non recurring events by range!\n", e);
    }

    if (!queue.maxTotalItemsReached) {
      // Process the recurring events
      let [recEvents, recEventFlags] = await this.getFullRecurringEventAndFlagMaps();
      for (let [id, evitem] of recEvents.entries()) {
        let cachedJournalFlag = recEventFlags.get(id);
        // No need to return flagged unless asked i.e. requestedOfflineJournal == cachedJournalFlag
        // Return created and modified offline records if requestedOfflineJournal is null alongwith events that have no flag
        if (
          (requestedOfflineJournal == null &&
            cachedJournalFlag != cICL.OFFLINE_FLAG_DELETED_RECORD) ||
          (requestedOfflineJournal != null && cachedJournalFlag == requestedOfflineJournal)
        ) {
          queue.add(this._expandOccurrences(evitem, startTime, rangeStart, rangeEnd, filters));
          if (queue.maxTotalItemsReached) {
            break;
          }
        }
      }
    }

    queue.flush();
    return queue.totalCount;
  }

  /**
   * Queries the database for calITodo records passing them to the provided
   * listener.
   * @param {CalStorageQuery} query
   * @param {GetItemsListener} listener
   *
   * @returns {number} The number of items retrieved.
   */
  async getTodos(query, listener) {
    let { filters, rangeStart, rangeEnd } = query;
    let startTime = DEFAULT_START_TIME;
    let endTime = DEFAULT_END_TIME;

    if (rangeStart) {
      startTime = rangeStart.nativeTime;
    }
    if (rangeEnd) {
      endTime = rangeEnd.nativeTime;
    }

    let queue = new CalTodoQueue(listener, query.count);
    let params; // stmt params
    let requestedOfflineJournal = null;

    if (filters.wantOfflineCreatedItems) {
      requestedOfflineJournal = cICL.OFFLINE_FLAG_CREATED_RECORD;
    } else if (filters.wantOfflineDeletedItems) {
      requestedOfflineJournal = cICL.OFFLINE_FLAG_DELETED_RECORD;
    } else if (filters.wantOfflineModifiedItems) {
      requestedOfflineJournal = cICL.OFFLINE_FLAG_MODIFIED_RECORD;
    }

    let checkCompleted = item =>
      item.isCompleted ? filters.itemCompletedFilter : filters.itemNotCompletedFilter;

    // first get non-recurring todos that happen to fall within the range
    try {
      this.db.prepareStatement(this.statements.mSelectNonRecurringTodosByRange);
      params = this.statements.mSelectNonRecurringTodosByRange.params;
      params.range_start = startTime;
      params.range_end = endTime;
      params.start_offset = rangeStart ? rangeStart.timezoneOffset * USECS_PER_SECOND : 0;
      params.end_offset = rangeEnd ? rangeEnd.timezoneOffset * USECS_PER_SECOND : 0;
      params.offline_journal = requestedOfflineJournal;

      await this.db.executeAsync(this.statements.mSelectNonRecurringTodosByRange, async row => {
        let todo = await this.getTodoFromRow(row);
        queue.add(
          this._expandOccurrences(todo, startTime, rangeStart, rangeEnd, filters, checkCompleted)
        );
      });
    } catch (e) {
      this.db.logError("Error selecting non recurring todos by range", e);
    }

    if (!queue.maxTotalItemsReached) {
      // Note: Reading the code, completed *occurrences* seems to be broken, because
      //       only the parent item has been filtered; I fixed that.
      //       Moreover item.todo_complete etc seems to be a leftover...

      // process the recurring todos
      let [recTodos, recTodoFlags] = await this.getFullRecurringTodoAndFlagMaps();
      for (let [id, todoitem] of recTodos) {
        let cachedJournalFlag = recTodoFlags.get(id);
        if (
          (requestedOfflineJournal == null &&
            (cachedJournalFlag == cICL.OFFLINE_FLAG_MODIFIED_RECORD ||
              cachedJournalFlag == cICL.OFFLINE_FLAG_CREATED_RECORD ||
              cachedJournalFlag == null)) ||
          (requestedOfflineJournal != null && cachedJournalFlag == requestedOfflineJournal)
        ) {
          queue.add(
            this._expandOccurrences(
              todoitem,
              startTime,
              rangeStart,
              rangeEnd,
              filters,
              checkCompleted
            )
          );
          if (queue.maxTotalItemsReached) {
            break;
          }
        }
      }
    }

    queue.flush();
    return queue.totalCount;
  }

  _checkUnrespondedInvitation(item) {
    let att = this._schedulingSupport.getInvitedAttendee(item);
    return att && att.participationStatus == "NEEDS-ACTION";
  }

  _expandOccurrences(item, startTime, rangeStart, rangeEnd, filters, optionalFilterFunc) {
    if (item.recurrenceInfo && item.recurrenceInfo.recurrenceEndDate < startTime) {
      return [];
    }

    let expandedItems = [];
    if (item.recurrenceInfo && filters.asOccurrences) {
      // If the item is recurring, get all occurrences that fall in
      // the range. If the item doesn't fall into the range at all,
      // this expands to 0 items.
      expandedItems = item.recurrenceInfo.getOccurrences(rangeStart, rangeEnd, 0);
      if (filters.wantUnrespondedInvitations) {
        expandedItems = expandedItems.filter(item => this._checkUnrespondedInvitation(item));
      }
    } else if (
      (!filters.wantUnrespondedInvitations || this._checkUnrespondedInvitation(item)) &&
      cal.item.checkIfInRange(item, rangeStart, rangeEnd)
    ) {
      // If no occurrences are wanted, check only the parent item.
      // This will be changed with bug 416975.
      expandedItems = [item];
    }

    if (expandedItems.length) {
      if (optionalFilterFunc) {
        expandedItems = expandedItems.filter(optionalFilterFunc);
      }
    }
    return expandedItems;
  }

  /**
   * Read in the common ItemBase attributes from aDBRow, and stick
   * them on item.
   *
   * @param {mozIStorageRow} row
   * @param {calIItemBase} item
   */
  getItemBaseFromRow(row, item) {
    item.calendar = this.calendar.superCalendar;
    item.id = row.getResultByName("id");
    if (row.getResultByName("title")) {
      item.title = row.getResultByName("title");
    }
    if (row.getResultByName("priority")) {
      item.priority = row.getResultByName("priority");
    }
    if (row.getResultByName("privacy")) {
      item.privacy = row.getResultByName("privacy");
    }
    if (row.getResultByName("ical_status")) {
      item.status = row.getResultByName("ical_status");
    }

    if (row.getResultByName("alarm_last_ack")) {
      // alarm acks are always in utc
      item.alarmLastAck = newDateTime(row.getResultByName("alarm_last_ack"), "UTC");
    }

    if (row.getResultByName("recurrence_id")) {
      item.recurrenceId = newDateTime(
        row.getResultByName("recurrence_id"),
        row.getResultByName("recurrence_id_tz")
      );
      if ((row.getResultByName("flags") & CAL_ITEM_FLAG.RECURRENCE_ID_ALLDAY) != 0) {
        item.recurrenceId.isDate = true;
      }
    }

    if (row.getResultByName("time_created")) {
      item.setProperty("CREATED", newDateTime(row.getResultByName("time_created"), "UTC"));
    }

    // This must be done last because the setting of any other property
    // after this would overwrite it again.
    if (row.getResultByName("last_modified")) {
      item.setProperty("LAST-MODIFIED", newDateTime(row.getResultByName("last_modified"), "UTC"));
    }
  }

  /**
   * @callback OnItemRowCallback
   * @param {string} id - The id of the item fetched from the row.
   */

  /**
   * Provides all recurring events along with offline flag values for each event.
   *
   * @param {OnItemRowCallback} [callback] - If provided, will be called on each row
   *                                         fetched.
   * @returns {[Map<string, calIEvent>, Map<string, number>]}
   */
  async getRecurringEventAndFlagMaps(callback) {
    let events = new Map();
    let flags = new Map();
    this.db.prepareStatement(this.statements.mSelectEventsWithRecurrence);
    await this.db.executeAsync(this.statements.mSelectEventsWithRecurrence, async row => {
      let item_id = row.getResultByName("id");
      if (callback) {
        callback(item_id);
      }
      let item = await this.getEventFromRow(row, false);
      events.set(item_id, item);
      flags.set(item_id, row.getResultByName("offline_journal") || null);
    });
    return [events, flags];
  }

  /**
   * Provides all recurring events with additional data populated along with
   * offline flags values for each event.
   *
   * @returns {[Map<string, calIEvent>, Map<string, number>]}
   */
  async getFullRecurringEventAndFlagMaps() {
    let [events, flags] = await this.getRecurringEventAndFlagMaps();
    return [await this.getAdditionalDataForItemMap(events), flags];
  }

  /**
   * Provides all recurring todos along with offline flag values for each event.
   *
   * @param {OnItemRowCallback} [callback] - If provided, will be called on each row
   *                                         fetched.
   *
   * @returns {[Map<string, calITodo>, Map<string, number>]}
   */
  async getRecurringTodoAndFlagMaps(callback) {
    let todos = new Map();
    let flags = new Map();
    this.db.prepareStatement(this.statements.mSelectTodosWithRecurrence);
    await this.db.executeAsync(this.statements.mSelectTodosWithRecurrence, async row => {
      let item_id = row.getResultByName("id");
      if (callback) {
        callback(item_id);
      }
      let item = await this.getTodoFromRow(row, false);
      todos.set(item_id, item);
      flags.set(item_id, row.getResultByName("offline_journal") || null);
    });
    return [todos, flags];
  }

  /**
   * Provides all recurring todos with additional data populated along with
   * offline flags values for each todo.
   *
   * @returns {[Map<string, calITodo>, Map<string, number>]}
   */
  async getFullRecurringTodoAndFlagMaps() {
    let [todos, flags] = await this.getRecurringTodoAndFlagMaps();
    return [await this.getAdditionalDataForItemMap(todos), flags];
  }

  /**
   * Populates additional data for a Map of items. This method is overridden in
   * CalStorageCachedItemModel to allow the todos to be loaded from the cache.
   *
   * @param {Map<string, calIItem>} itemMap
   *
   * @return {Map<string, calIItem>} The original Map with items modified.
   */
  async getAdditionalDataForItemMap(itemsMap) {
    //NOTE: There seems to be a bug in the SQLite subsystem that causes callers
    //awaiting on this method to continue prematurely. This can cause unexpected
    //behaviour. After investigating, it appears triggering the bug is related
    //to the number of queries executed here.
    this.db.prepareStatement(this.statements.mSelectAllAttendees);
    await this.db.executeAsync(this.statements.mSelectAllAttendees, row => {
      let item = itemsMap.get(row.getResultByName("item_id"));
      if (!item) {
        return;
      }

      let attendee = new CalAttendee(row.getResultByName("icalString"));
      if (attendee && attendee.id) {
        if (attendee.isOrganizer) {
          item.organizer = attendee;
        } else {
          item.addAttendee(attendee);
        }
      } else {
        cal.WARN(
          "[calStorageCalendar] Skipping invalid attendee for item '" +
            item.title +
            "' (" +
            item.id +
            ")."
        );
      }
    });

    this.db.prepareStatement(this.statements.mSelectAllProperties);
    await this.db.executeAsync(this.statements.mSelectAllProperties, row => {
      let item = itemsMap.get(row.getResultByName("item_id"));
      if (!item) {
        return;
      }

      let name = row.getResultByName("key");
      switch (name) {
        case "DURATION":
          // for events DTEND/DUE is enforced by calEvent/calTodo, so suppress DURATION:
          break;
        case "CATEGORIES": {
          let cats = cal.category.stringToArray(row.getResultByName("value"));
          item.setCategories(cats);
          break;
        }
        default:
          let value = row.getResultByName("value");
          item.setProperty(name, value);
          break;
      }
    });

    this.db.prepareStatement(this.statements.mSelectAllParameters);
    await this.db.executeAsync(this.statements.mSelectAllParameters, row => {
      let item = itemsMap.get(row.getResultByName("item_id"));
      if (!item) {
        return;
      }

      let prop = row.getResultByName("key1");
      let param = row.getResultByName("key2");
      let value = row.getResultByName("value");
      item.setPropertyParameter(prop, param, value);
    });

    this.db.prepareStatement(this.statements.mSelectAllRecurrences);
    await this.db.executeAsync(this.statements.mSelectAllRecurrences, row => {
      let item = itemsMap.get(row.getResultByName("item_id"));
      if (!item) {
        return;
      }

      let recInfo = item.recurrenceInfo;
      if (!recInfo) {
        recInfo = new CalRecurrenceInfo(item);
        item.recurrenceInfo = recInfo;
      }

      let ritem = this.getRecurrenceItemFromRow(row);
      recInfo.appendRecurrenceItem(ritem);
    });

    this.db.prepareStatement(this.statements.mSelectAllEventExceptions);
    await this.db.executeAsync(this.statements.mSelectAllEventExceptions, async row => {
      let item = itemsMap.get(row.getResultByName("id"));
      if (!item) {
        return;
      }

      let rec = item.recurrenceInfo;
      let exc = await this.getEventFromRow(row);
      rec.modifyException(exc, true);
    });

    this.db.prepareStatement(this.statements.mSelectAllTodoExceptions);
    await this.db.executeAsync(this.statements.mSelectAllTodoExceptions, async row => {
      let item = itemsMap.get(row.getResultByName("id"));
      if (!item) {
        return;
      }

      let rec = item.recurrenceInfo;
      let exc = await this.getTodoFromRow(row);
      rec.modifyException(exc, true);
    });

    this.db.prepareStatement(this.statements.mSelectAllAttachments);
    await this.db.executeAsync(this.statements.mSelectAllAttachments, row => {
      let item = itemsMap.get(row.getResultByName("item_id"));
      if (item) {
        item.addAttachment(new CalAttachment(row.getResultByName("icalString")));
      }
    });

    this.db.prepareStatement(this.statements.mSelectAllRelations);
    await this.db.executeAsync(this.statements.mSelectAllRelations, row => {
      let item = itemsMap.get(row.getResultByName("item_id"));
      if (item) {
        item.addRelation(new CalRelation(row.getResultByName("icalString")));
      }
    });

    this.db.prepareStatement(this.statements.mSelectAllAlarms);
    await this.db.executeAsync(this.statements.mSelectAllAlarms, row => {
      let item = itemsMap.get(row.getResultByName("item_id"));
      if (item) {
        item.addAlarm(new CalAlarm(row.getResultByName("icalString")));
      }
    });

    for (let item of itemsMap.values()) {
      this.fixGoogleCalendarDescriptionIfNeeded(item);
      item.makeImmutable();
    }
    return itemsMap;
  }

  /**
   * For items that were cached or stored in previous versions,
   * put Google's HTML description in the right place.
   *
   * @param {calIItemBase} item
   */
  fixGoogleCalendarDescriptionIfNeeded(item) {
    if (item.id && item.id.endsWith("@google.com")) {
      let description = item.getProperty("DESCRIPTION");
      if (description) {
        let altrep = item.getPropertyParameter("DESCRIPTION", "ALTREP");
        if (!altrep) {
          cal.view.fixGoogleCalendarDescription(item);
        }
      }
    }
  }

  /**
   * @param {mozIStorageRow} row
   * @param {boolean} getAdditionalData
   */
  async getEventFromRow(row, getAdditionalData = true) {
    let item = new CalEvent();
    let flags = row.getResultByName("flags");

    if (row.getResultByName("event_start")) {
      item.startDate = newDateTime(
        row.getResultByName("event_start"),
        row.getResultByName("event_start_tz")
      );
    }
    if (row.getResultByName("event_end")) {
      item.endDate = newDateTime(
        row.getResultByName("event_end"),
        row.getResultByName("event_end_tz")
      );
    }
    if (row.getResultByName("event_stamp")) {
      item.setProperty("DTSTAMP", newDateTime(row.getResultByName("event_stamp"), "UTC"));
    }
    if (flags & CAL_ITEM_FLAG.EVENT_ALLDAY) {
      item.startDate.isDate = true;
      item.endDate.isDate = true;
    }

    // This must be done last to keep the modification time intact.
    this.getItemBaseFromRow(row, item);
    if (getAdditionalData) {
      await this.getAdditionalDataForItem(item, row.getResultByName("flags"));
      item.makeImmutable();
    }
    return item;
  }

  /**
   * @param {mozIStorageRow} row
   * @param {boolean} getAdditionalData
   */
  async getTodoFromRow(row, getAdditionalData = true) {
    let item = new CalTodo();

    if (row.getResultByName("todo_entry")) {
      item.entryDate = newDateTime(
        row.getResultByName("todo_entry"),
        row.getResultByName("todo_entry_tz")
      );
    }
    if (row.getResultByName("todo_due")) {
      item.dueDate = newDateTime(
        row.getResultByName("todo_due"),
        row.getResultByName("todo_due_tz")
      );
    }
    if (row.getResultByName("todo_stamp")) {
      item.setProperty("DTSTAMP", newDateTime(row.getResultByName("todo_stamp"), "UTC"));
    }
    if (row.getResultByName("todo_completed")) {
      item.completedDate = newDateTime(
        row.getResultByName("todo_completed"),
        row.getResultByName("todo_completed_tz")
      );
    }
    if (row.getResultByName("todo_complete")) {
      item.percentComplete = row.getResultByName("todo_complete");
    }

    // This must be done last to keep the modification time intact.
    this.getItemBaseFromRow(row, item);
    if (getAdditionalData) {
      await this.getAdditionalDataForItem(item, row.getResultByName("flags"));
      item.makeImmutable();
    }
    return item;
  }

  /**
   * After we get the base item, we need to check if we need to pull in
   * any extra data from other tables. We do that here.
   */
  async getAdditionalDataForItem(item, flags) {
    // This is needed to keep the modification time intact.
    let savedLastModifiedTime = item.lastModifiedTime;

    if (flags & CAL_ITEM_FLAG.HAS_ATTENDEES) {
      let selectItem = null;
      if (item.recurrenceId == null) {
        selectItem = this.statements.mSelectAttendeesForItem;
      } else {
        selectItem = this.statements.mSelectAttendeesForItemWithRecurrenceId;
        this.setDateParamHelper(selectItem, "recurrence_id", item.recurrenceId);
      }

      try {
        this.db.prepareStatement(selectItem);
        selectItem.params.item_id = item.id;
        await this.db.executeAsync(selectItem, row => {
          let attendee = new CalAttendee(row.getResultByName("icalString"));
          if (attendee && attendee.id) {
            if (attendee.isOrganizer) {
              item.organizer = attendee;
            } else {
              item.addAttendee(attendee);
            }
          } else {
            cal.WARN(
              `[calStorageCalendar] Skipping invalid attendee for item '${item.title}' (${item.id}).`
            );
          }
        });
      } catch (e) {
        this.db.logError(`Error getting attendees for item '${item.title}' (${item.id})!`, e);
      }
    }

    if (flags & CAL_ITEM_FLAG.HAS_PROPERTIES) {
      let selectItem = null;
      let selectParam = null;
      if (item.recurrenceId == null) {
        selectItem = this.statements.mSelectPropertiesForItem;
        selectParam = this.statements.mSelectParametersForItem;
      } else {
        selectItem = this.statements.mSelectPropertiesForItemWithRecurrenceId;
        this.setDateParamHelper(selectItem, "recurrence_id", item.recurrenceId);
        selectParam = this.statements.mSelectParametersForItemWithRecurrenceId;
        this.setDateParamHelper(selectParam, "recurrence_id", item.recurrenceId);
      }

      try {
        this.db.prepareStatement(selectItem);
        selectItem.params.item_id = item.id;
        await this.db.executeAsync(selectItem, row => {
          let name = row.getResultByName("key");
          switch (name) {
            case "DURATION":
              // for events DTEND/DUE is enforced by calEvent/calTodo, so suppress DURATION:
              break;
            case "CATEGORIES": {
              let cats = cal.category.stringToArray(row.getResultByName("value"));
              item.setCategories(cats);
              break;
            }
            default:
              let value = row.getResultByName("value");
              item.setProperty(name, value);
              break;
          }
        });

        this.db.prepareStatement(selectParam);
        selectParam.params.item_id = item.id;
        await this.db.executeAsync(selectParam, row => {
          let prop = row.getResultByName("key1");
          let param = row.getResultByName("key2");
          let value = row.getResultByName("value");
          item.setPropertyParameter(prop, param, value);
        });
      } catch (e) {
        this.db.logError(
          "Error getting extra properties for item '" + item.title + "' (" + item.id + ")!",
          e
        );
      }
    }

    if (flags & CAL_ITEM_FLAG.HAS_RECURRENCE) {
      if (item.recurrenceId) {
        throw Components.Exception("", Cr.NS_ERROR_UNEXPECTED);
      }

      let recInfo = new CalRecurrenceInfo(item);
      item.recurrenceInfo = recInfo;

      try {
        this.db.prepareStatement(this.statements.mSelectRecurrenceForItem);
        this.statements.mSelectRecurrenceForItem.params.item_id = item.id;
        await this.db.executeAsync(this.statements.mSelectRecurrenceForItem, row => {
          let ritem = this.getRecurrenceItemFromRow(row);
          recInfo.appendRecurrenceItem(ritem);
        });
      } catch (e) {
        this.db.logError(
          "Error getting recurrence for item '" + item.title + "' (" + item.id + ")!",
          e
        );
      }
    }

    if (flags & CAL_ITEM_FLAG.HAS_EXCEPTIONS) {
      // it's safe that we don't run into this branch again for exceptions
      // (getAdditionalDataForItem->get[Event|Todo]FromRow->getAdditionalDataForItem):
      // every excepton has a recurrenceId and isn't flagged as CAL_ITEM_FLAG.HAS_EXCEPTIONS
      if (item.recurrenceId) {
        throw Components.Exception("", Cr.NS_ERROR_UNEXPECTED);
      }

      let rec = item.recurrenceInfo;

      if (item.isEvent()) {
        this.statements.mSelectEventExceptions.params.id = item.id;
        this.db.prepareStatement(this.statements.mSelectEventExceptions);
        try {
          await this.db.executeAsync(this.statements.mSelectEventExceptions, async row => {
            let exc = await this.getEventFromRow(row, false);
            rec.modifyException(exc, true);
          });
        } catch (e) {
          this.db.logError(
            "Error getting exceptions for event '" + item.title + "' (" + item.id + ")!",
            e
          );
        }
      } else if (item.isTodo()) {
        this.statements.mSelectTodoExceptions.params.id = item.id;
        this.db.prepareStatement(this.statements.mSelectTodoExceptions);
        try {
          await this.db.executeAsync(this.statements.mSelectTodoExceptions, async row => {
            let exc = await this.getTodoFromRow(row, false);
            rec.modifyException(exc, true);
          });
        } catch (e) {
          this.db.logError(
            "Error getting exceptions for task '" + item.title + "' (" + item.id + ")!",
            e
          );
        }
      } else {
        throw Components.Exception("", Cr.NS_ERROR_UNEXPECTED);
      }
    }

    if (flags & CAL_ITEM_FLAG.HAS_ATTACHMENTS) {
      let selectAttachment = this.statements.mSelectAttachmentsForItem;
      if (item.recurrenceId != null) {
        selectAttachment = this.statements.mSelectAttachmentsForItemWithRecurrenceId;
        this.setDateParamHelper(selectAttachment, "recurrence_id", item.recurrenceId);
      }
      try {
        this.db.prepareStatement(selectAttachment);
        selectAttachment.params.item_id = item.id;
        await this.db.executeAsync(selectAttachment, row => {
          item.addAttachment(new CalAttachment(row.getResultByName("icalString")));
        });
      } catch (e) {
        this.db.logError(
          "Error getting attachments for item '" + item.title + "' (" + item.id + ")!",
          e
        );
      }
    }

    if (flags & CAL_ITEM_FLAG.HAS_RELATIONS) {
      let selectRelation = this.statements.mSelectRelationsForItem;
      if (item.recurrenceId != null) {
        selectRelation = this.statements.mSelectRelationsForItemWithRecurrenceId;
        this.setDateParamHelper(selectRelation, "recurrence_id", item.recurrenceId);
      }
      try {
        this.db.prepareStatement(selectRelation);
        selectRelation.params.item_id = item.id;
        await this.db.executeAsync(selectRelation, row => {
          item.addRelation(new CalRelation(row.getResultByName("icalString")));
        });
      } catch (e) {
        this.db.logError(
          "Error getting relations for item '" + item.title + "' (" + item.id + ")!",
          e
        );
      }
    }

    if (flags & CAL_ITEM_FLAG.HAS_ALARMS) {
      let selectAlarm = this.statements.mSelectAlarmsForItem;
      if (item.recurrenceId != null) {
        selectAlarm = this.statements.mSelectAlarmsForItemWithRecurrenceId;
        this.setDateParamHelper(selectAlarm, "recurrence_id", item.recurrenceId);
      }
      try {
        selectAlarm.params.item_id = item.id;
        this.db.prepareStatement(selectAlarm);
        await this.db.executeAsync(selectAlarm, row => {
          item.addAlarm(new CalAlarm(row.getResultByName("icalString")));
        });
      } catch (e) {
        this.db.logError(
          "Error getting alarms for item '" + item.title + "' (" + item.id + ")!",
          e
        );
      }
    }

    this.fixGoogleCalendarDescriptionIfNeeded(item);
    // Restore the saved modification time
    item.setProperty("LAST-MODIFIED", savedLastModifiedTime);
  }

  getRecurrenceItemFromRow(row, item) {
    let ritem;
    let prop = cal.getIcsService().createIcalPropertyFromString(row.getResultByName("icalString"));
    switch (prop.propertyName) {
      case "RDATE":
      case "EXDATE":
        ritem = Cc["@mozilla.org/calendar/recurrence-date;1"].createInstance(Ci.calIRecurrenceDate);
        break;
      case "RRULE":
      case "EXRULE":
        ritem = cal.createRecurrenceRule();
        break;
      default:
        throw new Error("Unknown recurrence item: " + prop.propertyName);
    }

    ritem.icalProperty = prop;
    return ritem;
  }

  /**
   * Get an item from db given its id.
   *
   * @param {string} aID
   */
  async getItemById(aID) {
    let item;
    try {
      // try events first
      this.db.prepareStatement(this.statements.mSelectEvent);
      this.statements.mSelectEvent.params.id = aID;
      await this.db.executeAsync(this.statements.mSelectEvent, async row => {
        item = await this.getEventFromRow(row);
      });
    } catch (e) {
      this.db.logError("Error selecting item by id " + aID + "!", e);
    }

    // try todo if event fails
    if (!item) {
      try {
        this.db.prepareStatement(this.statements.mSelectTodo);
        this.statements.mSelectTodo.params.id = aID;
        await this.db.executeAsync(this.statements.mSelectTodo, async row => {
          item = await this.getTodoFromRow(row);
        });
      } catch (e) {
        this.db.logError("Error selecting item by id " + aID + "!", e);
      }
    }
    return item;
  }

  setDateParamHelper(params, entryname, cdt) {
    if (cdt) {
      params.bindByName(entryname, cdt.nativeTime);
      let timezone = cdt.timezone;
      let ownTz = cal.getTimezoneService().getTimezone(timezone.tzid);
      if (ownTz) {
        // if we know that TZID, we use it
        params.bindByName(entryname + "_tz", ownTz.tzid);
      } else if (timezone.icalComponent) {
        // foreign one
        params.bindByName(entryname + "_tz", timezone.icalComponent.serializeToICS());
      } else {
        // timezone component missing
        params.bindByName(entryname + "_tz", "floating");
      }
    } else {
      params.bindByName(entryname, null);
      params.bindByName(entryname + "_tz", null);
    }
  }

  /**
   * Adds an item to the database, the item should have an id that is not
   * already in use.
   *
   * @param {calIItemBase} item
   */
  async addItem(item) {
    let stmts = new Map();
    this.prepareItem(stmts, item);
    for (let [stmt, array] of stmts) {
      stmt.bindParameters(array);
    }
    await this.db.executeAsync([...stmts.keys()]);
  }

  // The prepare* functions prepare the database bits
  // to write the given item type. They're to return
  // any bits they want or'd into flags, which will be
  // prepared for writing by prepareEvent/prepareTodo.
  //
  prepareItem(stmts, item, olditem) {
    let flags = 0;

    flags |= this.prepareAttendees(stmts, item, olditem);
    flags |= this.prepareRecurrence(stmts, item, olditem);
    flags |= this.prepareProperties(stmts, item, olditem);
    flags |= this.prepareAttachments(stmts, item, olditem);
    flags |= this.prepareRelations(stmts, item, olditem);
    flags |= this.prepareAlarms(stmts, item, olditem);

    if (item.isEvent()) {
      this.prepareEvent(stmts, item, olditem, flags);
    } else if (item.isTodo()) {
      this.prepareTodo(stmts, item, olditem, flags);
    } else {
      throw Components.Exception("", Cr.NS_ERROR_UNEXPECTED);
    }
  }

  prepareEvent(stmts, item, olditem, flags) {
    let array = this.db.prepareAsyncStatement(stmts, this.statements.mInsertEvent);
    let params = this.db.prepareAsyncParams(array);

    this.setupItemBaseParams(item, olditem, params);

    this.setDateParamHelper(params, "event_start", item.startDate);
    this.setDateParamHelper(params, "event_end", item.endDate);
    let dtstamp = item.stampTime;
    params.bindByName("event_stamp", dtstamp && dtstamp.nativeTime);

    if (item.startDate.isDate) {
      flags |= CAL_ITEM_FLAG.EVENT_ALLDAY;
    }

    params.bindByName("flags", flags);

    array.addParams(params);
  }

  prepareTodo(stmts, item, olditem, flags) {
    let array = this.db.prepareAsyncStatement(stmts, this.statements.mInsertTodo);
    let params = this.db.prepareAsyncParams(array);

    this.setupItemBaseParams(item, olditem, params);

    this.setDateParamHelper(params, "todo_entry", item.entryDate);
    this.setDateParamHelper(params, "todo_due", item.dueDate);
    let dtstamp = item.stampTime;
    params.bindByName("todo_stamp", dtstamp && dtstamp.nativeTime);
    this.setDateParamHelper(params, "todo_completed", item.getProperty("COMPLETED"));

    params.bindByName("todo_complete", item.getProperty("PERCENT-COMPLETED"));

    let someDate = item.entryDate || item.dueDate;
    if (someDate && someDate.isDate) {
      flags |= CAL_ITEM_FLAG.EVENT_ALLDAY;
    }

    params.bindByName("flags", flags);

    array.addParams(params);
  }

  setupItemBaseParams(item, olditem, params) {
    params.bindByName("id", item.id);

    this.setDateParamHelper(params, "recurrence_id", item.recurrenceId);

    let tmp = item.getProperty("CREATED");
    params.bindByName("time_created", tmp && tmp.nativeTime);

    tmp = item.getProperty("LAST-MODIFIED");
    params.bindByName("last_modified", tmp && tmp.nativeTime);

    params.bindByName("title", item.getProperty("SUMMARY"));
    params.bindByName("priority", item.getProperty("PRIORITY"));
    params.bindByName("privacy", item.getProperty("CLASS"));
    params.bindByName("ical_status", item.getProperty("STATUS"));

    params.bindByName("alarm_last_ack", item.alarmLastAck && item.alarmLastAck.nativeTime);
  }

  prepareAttendees(stmts, item, olditem) {
    let attendees = item.getAttendees();
    if (item.organizer) {
      attendees = attendees.concat([]);
      attendees.push(item.organizer);
    }
    if (attendees.length > 0) {
      let array = this.db.prepareAsyncStatement(stmts, this.statements.mInsertAttendee);
      for (let att of attendees) {
        let params = this.db.prepareAsyncParams(array);
        params.bindByName("item_id", item.id);
        this.setDateParamHelper(params, "recurrence_id", item.recurrenceId);
        params.bindByName("icalString", att.icalString);
        array.addParams(params);
      }

      return CAL_ITEM_FLAG.HAS_ATTENDEES;
    }

    return 0;
  }

  prepareProperty(stmts, item, propName, propValue) {
    let array = this.db.prepareAsyncStatement(stmts, this.statements.mInsertProperty);
    let params = this.db.prepareAsyncParams(array);
    params.bindByName("key", propName);
    let wPropValue = cal.wrapInstance(propValue, Ci.calIDateTime);
    if (wPropValue) {
      params.bindByName("value", wPropValue.nativeTime);
    } else {
      try {
        params.bindByName("value", propValue);
      } catch (e) {
        // The storage service throws an NS_ERROR_ILLEGAL_VALUE in
        // case pval is something complex (i.e not a string or
        // number). Swallow this error, leaving the value empty.
        if (e.result != Cr.NS_ERROR_ILLEGAL_VALUE) {
          throw e;
        }
        params.bindByName("value", null);
      }
    }
    params.bindByName("item_id", item.id);
    this.setDateParamHelper(params, "recurrence_id", item.recurrenceId);
    array.addParams(params);
  }

  prepareParameter(stmts, item, propName, paramName, propValue) {
    let array = this.db.prepareAsyncStatement(stmts, this.statements.mInsertParameter);
    let params = this.db.prepareAsyncParams(array);
    params.bindByName("key1", propName);
    params.bindByName("key2", paramName);
    let wPropValue = cal.wrapInstance(propValue, Ci.calIDateTime);
    if (wPropValue) {
      params.bindByName("value", wPropValue.nativeTime);
    } else {
      try {
        params.bindByName("value", propValue);
      } catch (e) {
        // The storage service throws an NS_ERROR_ILLEGAL_VALUE in
        // case pval is something complex (i.e not a string or
        // number). Swallow this error, leaving the value empty.
        if (e.result != Cr.NS_ERROR_ILLEGAL_VALUE) {
          throw e;
        }
        params.bindByName("value", null);
      }
    }
    params.bindByName("item_id", item.id);
    this.setDateParamHelper(params, "recurrence_id", item.recurrenceId);
    array.addParams(params);
  }

  prepareProperties(stmts, item, olditem) {
    let ret = 0;
    for (let [name, value] of item.properties) {
      ret = CAL_ITEM_FLAG.HAS_PROPERTIES;
      if (item.isPropertyPromoted(name)) {
        continue;
      }
      this.prepareProperty(stmts, item, name, value);
      // Overridden parameters still enumerate even if their value is now empty.
      if (item.hasProperty(name)) {
        for (let param of item.getParameterNames(name)) {
          value = item.getPropertyParameter(name, param);
          this.prepareParameter(stmts, item, name, param, value);
        }
      }
    }

    let cats = item.getCategories();
    if (cats.length > 0) {
      ret = CAL_ITEM_FLAG.HAS_PROPERTIES;
      this.prepareProperty(stmts, item, "CATEGORIES", cal.category.arrayToString(cats));
    }

    return ret;
  }

  prepareRecurrence(stmts, item, olditem) {
    let flags = 0;

    let rec = item.recurrenceInfo;
    if (rec) {
      flags = CAL_ITEM_FLAG.HAS_RECURRENCE;
      let ritems = rec.getRecurrenceItems();
      let array = this.db.prepareAsyncStatement(stmts, this.statements.mInsertRecurrence);
      for (let ritem of ritems) {
        let params = this.db.prepareAsyncParams(array);
        params.bindByName("item_id", item.id);
        params.bindByName("icalString", ritem.icalString);
        array.addParams(params);
      }

      let exceptions = rec.getExceptionIds();
      if (exceptions.length > 0) {
        flags |= CAL_ITEM_FLAG.HAS_EXCEPTIONS;

        // we need to serialize each exid as a separate
        // event/todo; setupItemBase will handle
        // writing the recurrenceId for us
        for (let exid of exceptions) {
          let ex = rec.getExceptionFor(exid);
          if (!ex) {
            throw Components.Exception("", Cr.NS_ERROR_UNEXPECTED);
          }
          this.prepareItem(stmts, ex, null);
        }
      }
    } else if (item.recurrenceId && item.recurrenceId.isDate) {
      flags |= CAL_ITEM_FLAG.RECURRENCE_ID_ALLDAY;
    }

    return flags;
  }

  prepareAttachments(stmts, item, olditem) {
    let attachments = item.getAttachments();
    if (attachments && attachments.length > 0) {
      let array = this.db.prepareAsyncStatement(stmts, this.statements.mInsertAttachment);
      for (let att of attachments) {
        let params = this.db.prepareAsyncParams(array);
        this.setDateParamHelper(params, "recurrence_id", item.recurrenceId);
        params.bindByName("item_id", item.id);
        params.bindByName("icalString", att.icalString);

        array.addParams(params);
      }
      return CAL_ITEM_FLAG.HAS_ATTACHMENTS;
    }
    return 0;
  }

  prepareRelations(stmts, item, olditem) {
    let relations = item.getRelations();
    if (relations && relations.length > 0) {
      let array = this.db.prepareAsyncStatement(stmts, this.statements.mInsertRelation);
      for (let rel of relations) {
        let params = this.db.prepareAsyncParams(array);
        this.setDateParamHelper(params, "recurrence_id", item.recurrenceId);
        params.bindByName("item_id", item.id);
        params.bindByName("icalString", rel.icalString);

        array.addParams(params);
      }
      return CAL_ITEM_FLAG.HAS_RELATIONS;
    }
    return 0;
  }

  prepareAlarms(stmts, item, olditem) {
    let alarms = item.getAlarms();
    if (alarms.length < 1) {
      return 0;
    }

    let array = this.db.prepareAsyncStatement(stmts, this.statements.mInsertAlarm);
    for (let alarm of alarms) {
      let params = this.db.prepareAsyncParams(array);
      this.setDateParamHelper(params, "recurrence_id", item.recurrenceId);
      params.bindByName("item_id", item.id);
      params.bindByName("icalString", alarm.icalString);

      array.addParams(params);
    }

    return CAL_ITEM_FLAG.HAS_ALARMS;
  }

  /**
   * Deletes the item with the given item id.
   *
   * @param {string} id The id of the item to delete.
   * @param {boolean} keepMeta If true, leave metadata for the item.
   */
  async deleteItemById(id, keepMeta) {
    let stmts = [];
    this.db.prepareItemStatement(stmts, this.statements.mDeleteAttendees, "item_id", id);
    this.db.prepareItemStatement(stmts, this.statements.mDeleteProperties, "item_id", id);
    this.db.prepareItemStatement(stmts, this.statements.mDeleteRecurrence, "item_id", id);
    this.db.prepareItemStatement(stmts, this.statements.mDeleteEvent, "id", id);
    this.db.prepareItemStatement(stmts, this.statements.mDeleteTodo, "id", id);
    this.db.prepareItemStatement(stmts, this.statements.mDeleteAttachments, "item_id", id);
    this.db.prepareItemStatement(stmts, this.statements.mDeleteRelations, "item_id", id);
    if (!keepMeta) {
      this.db.prepareItemStatement(stmts, this.statements.mDeleteMetaData, "item_id", id);
    }
    this.db.prepareItemStatement(stmts, this.statements.mDeleteAlarms, "item_id", id);
    await this.db.executeAsync(stmts);
  }
}