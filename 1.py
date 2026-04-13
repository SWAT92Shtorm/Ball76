from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.support.ui import WebDriverWait
from webdriver_manager.chrome import ChromeDriverManager
from selenium.webdriver.support import expected_conditions as EC
import time
import csv
from datetime import datetime

driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()))

driver.get("http://qlapinui.dqsmd.qrundigital.diasoft.ru/interface/qlapinui/qlapin-45/processes/product-info?process=input-app&appId=66993737-4e12-3394-75f7-69a1aae4b062")
time.sleep(5)

login_field = driver.find_element(By.CSS_SELECTOR, "app-username-type input")
login_field.send_keys("msa") 

login_field = driver.find_element(By.CSS_SELECTOR, "#password input")
login_field.send_keys("1234567890") 

time.sleep(1)

submit_button = driver.find_element(By.CSS_SELECTOR, ".p-d-flex.p-flex-column.w-full.p-gap-2 button")
submit_button.click()

time.sleep(10)

print("\n🔍 Извлекаем ВСЕ поля через JavaScript (включая Shadow DOM)...")

fields = driver.execute_script("""
const fields = [];

// Функция для рекурсивного поиска во всех Shadow DOM
function getAllInputs(root) {
    const inputs = [];
    const elements = root.querySelectorAll('input, select, textarea');
    elements.forEach(el => inputs.push(el));
    
    // Ищем внутри Shadow DOM
    const shadowHosts = root.querySelectorAll('*');
    shadowHosts.forEach(host => {
        if (host.shadowRoot) {
            inputs.push(...getAllInputs(host.shadowRoot));
        }
    });
    return inputs;
}

// Собираем все поля из document и всех Shadow DOM
const allInputs = getAllInputs(document);

allInputs.forEach(input => {
    const name = input.name || input.id || input.getAttribute('placeholder') || input.className.split(' ')[0] || 'поле_' + Math.random().toString(36).substr(2, 5);
    let value;
    
    if (input.type === 'checkbox' || input.type === 'radio') {
        value = input.checked ? (input.value || 'checked') : '';
    } else if (input.type === 'file') {
        value = input.files.length > 0 ? input.files[0].name : '';
    } else {
        // Берём value напрямую и через propertyName для Angular/React
        value = input.value || input._value || input.$$value || '';
    }
    
    // Также пробуем взять текст из labels Nearby
    let label = '';
    const labelTag = document.querySelector(`label[for="${input.id}"]`);
    if (labelTag) label = labelTag.textContent.trim();
    
    // Пропускаем совсем пустые поля, если хотим только заполненные
    if (value || label) {
        fields.push({
            name: name,
            label: label,
            value: value,
            type: input.type || 'text',
            tagName: input.tagName.toLowerCase(),
            id: input.id || '',
            class: input.className || ''
        });
    }
});

return fields;
""")

print(f"\n=== НАЙДЕНО {len(fields)} ПОЛЕЙ ===")
for i, f in enumerate(fields):
    print(f"{i+1}. [{f['tagName']}/{f['type']}] {f['name']} {f['label']}: '{f['value']}'")

timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
csv_file = f"form_data_{timestamp}.csv"
with openПрошу прощения, код оборвался. Вот полный исправленный скрипт, который собирает все типы полей (включая select, textarea, checkbox, radio и поля с data-атрибутами):

```python
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.service import Service
from webdriver_manager.chrome import ChromeDriverManager
import time
import csv
from datetime import datetime

driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()))

driver.get("http://qlapinui.dqsmd.qrundigital.diasoft.ru/interface/qlapinui/qlapin-45/processes/product-info?process=input-app&appId=66993737-4e12-3394-75f7-69a1aae4b062")
time.sleep(5)

login_field = driver.find_element(By.CSS_SELECTOR, "app-username-type input")
login_field.send_keys("msa") 

login_field = driver.find_element(By.CSS_SELECTOR, "#password input")
login_field.send_keys("1234567890") 

time.sleep(1)

submit_button = driver.find_element(By.CSS_SELECTOR, ".p-d-flex.p-flex-column.w-full.p-gap-2 button")
submit_button.click()

time.sleep(10)

print("\n🔍 Извлекаем все поля через JavaScript...")

fields = driver.execute_script("""
const fields = [];

// Функция для получения значения элемента
function getValue(el) {
    if (el.type === 'checkbox' || el.type === 'radio') {
        return el.checked ? el.value : '';
    } else if (el.type === 'file') {
        return el.files.length > 0 ? el.files.name : '';
    } else if (el.tagName === 'SELECT') {
        return el.options[el.selectedIndex]?.text || el.value;
    } else if (el.tagName === 'TEXTAREA') {
        return el.value;
    }
    return el.value || '';
}

// Получаем все поля
const inputs = document.querySelectorAll('input, select, textarea');

inputs.forEach(input => {
    let name = input.name;
    
    // Если нет name, пробуем id, label или data-атрибуты
    if (!name && input.id) name = input.id;
    if (!name && input.dataset && input.dataset.label) name = input.dataset.label;
    if (!name && input.dataset && input.dataset.name) name = input.dataset.name;
    if (!name) {
        // Пробуем найти label
        const label = document.querySelector(`label[for="${input.id}"]`);
        if (label) name = label.textContent.trim();
    }
    if (!name) name = 'без_имени_' + Math.random().toString(36).substr(2, 5);
    
    const value = getValue(input);
    
    if (value) {
        fields.push({
            name: name,
            value: value,
            type: input.type || input.tagName.toLowerCase(),
            tagName: input.tagName.toLowerCase(),
            id: input.id || '',
            class: input.className || ''
        });
    }
});

return fields;
""")

print("\n=== ДАННЫЕ ФОРМЫ ===")
for i, f in enumerate(fields):
    print(f"{i+1}. {f['name']} ({f['tagName']}): {f['value']}")

timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
csv_file = f"form_data_{timestamp}.csv"
with open(csv_file, "w", encoding="utf-8-sig", newline="") as f:
    writer = csv.DictWriter(f, fieldnames=["Название", "Тип", "Значение"])
    writer.writeheader()
    writer.writerows([{"Название": f["name"], "Тип": f["tagName"], "Значение": f["value"]} for f in fields])

print(f"\n✅ Сохранено: {csv_file}")

driver.quit()
