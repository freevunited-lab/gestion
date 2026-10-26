// Menus déroulants Freev : le <select> original reste la source de vérité pour les formulaires.
(() => {
  const SELECTOR = 'select:not([multiple]):not([data-freev-native-select])';
  let sequence = 0;

  const optionLabel = option => option?.textContent?.trim() || 'Sélectionner';
  const optionId = select => select.id || `freev-select-${++sequence}`;

  function accessibleLabel(select) {
    const label = select.getAttribute('aria-label') || select.labels?.[0]?.textContent?.trim();
    return label || select.getAttribute('title') || optionId(select);
  }

  function create(select) {
    if (select.dataset.freevNativeSelect) return select._freevCustomSelect;
    const sourceId = optionId(select);
    if (!select.id) select.id = sourceId;
    const wrapper = document.createElement('div');
    const trigger = document.createElement('button');
    const list = document.createElement('div');
    const listId = `${sourceId}-freev-list`;
    const label = accessibleLabel(select);

    wrapper.className = 'freev-select';
    wrapper.dataset.freevSelectFor = sourceId;
    wrapper.style.maxWidth = select.style.maxWidth;
    trigger.type = 'button';
    trigger.className = 'freev-select-trigger';
    trigger.dataset.freevSelectTrigger = '';
    trigger.setAttribute('role', 'combobox');
    trigger.setAttribute('aria-label', label);
    trigger.setAttribute('aria-controls', listId);
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.innerHTML = '<span data-freev-select-value></span><i class="fa-solid fa-chevron-down" aria-hidden="true"></i>';
    list.id = listId;
    list.className = 'freev-select-list';
    list.dataset.freevSelectList = '';
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', label);
    list.setAttribute('aria-hidden', 'true');
    list.hidden = true;
    wrapper.append(trigger, list);
    select.insertAdjacentElement('afterend', wrapper);
    select.dataset.freevNativeSelect = 'true';
    select.classList.add('freev-select-native');
    select.setAttribute('aria-hidden', 'true');
    select.tabIndex = -1;

    const control = { select, wrapper, trigger, list, close: () => close(control), sync: () => sync(control) };
    select._freevCustomSelect = control;
    wrapper._freevSelectControl = control;
    const observer = new MutationObserver(() => sync(control));
    observer.observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'selected', 'label'] });
    select.addEventListener('change', () => sync(control));
    select.labels?.forEach(item => item.addEventListener('click', event => {
      event.preventDefault();
      trigger.focus();
      open(control);
    }));
    trigger.addEventListener('click', () => (list.hidden ? open(control) : close(control)));
    trigger.addEventListener('keydown', event => triggerKeydown(event, control));
    list.addEventListener('keydown', event => listKeydown(event, control));
    sync(control);
    return control;
  }

  function sync(control) {
    const { select, trigger, list, wrapper } = control;
    const focusedIndex = list.contains(document.activeElement) ? Number(document.activeElement.dataset.optionIndex) : -1;
    wrapper.classList.toggle('is-disabled', select.disabled);
    trigger.disabled = select.disabled;
    const selected = select.selectedOptions?.[0] || select.options[0];
    trigger.querySelector('[data-freev-select-value]').textContent = optionLabel(selected);
    list.replaceChildren(...[...select.options].map((option, index) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'freev-select-option';
      item.dataset.freevSelectOption = option.value;
      item.dataset.optionIndex = String(index);
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(option.selected));
      item.disabled = option.disabled;
      item.textContent = optionLabel(option);
      item.addEventListener('click', () => choose(control, index));
      return item;
    }));
    if (focusedIndex >= 0 && !list.hidden) list.querySelector(`[data-option-index="${focusedIndex}"]`)?.focus();
  }

  function open(control) {
    if (control.select.disabled) return;
    document.querySelectorAll('.freev-select:not([data-freev-select-for="' + control.wrapper.dataset.freevSelectFor + '"])')
      .forEach(wrapper => wrapper._freevSelectControl?.close());
    control.list.hidden = false;
    const roomBelow = window.innerHeight - control.trigger.getBoundingClientRect().bottom;
    const roomAbove = control.trigger.getBoundingClientRect().top;
    control.wrapper.classList.toggle('opens-up', roomBelow < Math.min(290, control.list.scrollHeight + 12) && roomAbove > roomBelow);
    control.list.setAttribute('aria-hidden', 'false');
    control.trigger.setAttribute('aria-expanded', 'true');
    control.wrapper.classList.add('is-open');
    control.list.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }

  function close(control) {
    control.list.hidden = true;
    control.list.setAttribute('aria-hidden', 'true');
    control.trigger.setAttribute('aria-expanded', 'false');
    control.wrapper.classList.remove('is-open');
    control.wrapper.classList.remove('opens-up');
  }

  function enabledOptions(control) {
    return [...control.list.querySelectorAll('.freev-select-option:not(:disabled)')];
  }

  function focusOption(control, direction = 0) {
    const options = enabledOptions(control);
    if (!options.length) return;
    const active = document.activeElement.closest?.('.freev-select-option');
    const selected = options.findIndex(item => item.getAttribute('aria-selected') === 'true');
    const current = active ? options.indexOf(active) : selected;
    const index = Math.max(0, Math.min(options.length - 1, (current < 0 ? 0 : current) + direction));
    options[index].focus();
  }

  function choose(control, index) {
    const option = control.select.options[index];
    if (!option || option.disabled) return;
    control.select.selectedIndex = index;
    control.select.dispatchEvent(new Event('input', { bubbles: true }));
    control.select.dispatchEvent(new Event('change', { bubbles: true }));
    close(control);
    control.trigger.focus();
  }

  function triggerKeydown(event, control) {
    if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      open(control);
      focusOption(control, event.key === 'ArrowDown' ? 1 : -1);
    } else if (['Enter', ' '].includes(event.key)) {
      event.preventDefault();
      control.list.hidden ? open(control) : close(control);
    } else if (event.key === 'Escape') {
      close(control);
    } else if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
      open(control);
      focusMatchingOption(control, event.key);
    }
  }

  function listKeydown(event, control) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      focusOption(control, event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const options = enabledOptions(control);
      options[event.key === 'Home' ? 0 : options.length - 1]?.focus();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close(control);
      control.trigger.focus();
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const index = Number(document.activeElement.dataset.optionIndex);
      choose(control, index);
    } else if (event.key === 'Tab') {
      close(control);
    } else if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
      focusMatchingOption(control, event.key);
    }
  }

  function focusMatchingOption(control, character) {
    const options = enabledOptions(control);
    if (!options.length) return;
    const now = Date.now();
    control.searchQuery = now - (control.lastSearchAt || 0) < 650
      ? `${control.searchQuery || ''}${character.toLocaleLowerCase('fr-FR')}`
      : character.toLocaleLowerCase('fr-FR');
    control.lastSearchAt = now;
    const active = options.indexOf(document.activeElement);
    const ordered = options.slice(active + 1).concat(options.slice(0, active + 1));
    const matches = query => ordered.find(option => option.textContent.trim().toLocaleLowerCase('fr-FR').startsWith(query));
    (matches(control.searchQuery) || matches(character.toLocaleLowerCase('fr-FR')))?.focus();
  }

  function refresh(root = document) {
    root.querySelectorAll?.(SELECTOR).forEach(create);
    root.querySelectorAll?.('[data-freev-native-select]').forEach(select => select._freevCustomSelect?.sync());
  }

  document.addEventListener('pointerdown', event => {
    document.querySelectorAll('.freev-select.is-open').forEach(wrapper => {
      if (!wrapper.contains(event.target)) wrapper._freevSelectControl?.close();
    });
  });
  document.addEventListener('DOMContentLoaded', () => {
    refresh();
    new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(node => {
      if (node.nodeType === Node.ELEMENT_NODE) refresh(node);
    }))).observe(document.body, { childList: true, subtree: true });
  }, { once: true });
  window.FreevCustomSelects = { refresh };
})();
