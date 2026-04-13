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

# Открываем уже готовую страницу
driver.get("http://qlapinui.dqsmd.qrundigital.diasoft.ru/interface/qlapinui/qlapin-45/processes/product-info?process=input-app&appId=66993737-4e12-3394-75f7-69a1aae4b062")
time.sleep(5)

# Логин
login_field = driver.find_element(By.CSS_SELECTOR, "app-username-type input")
login_field.send_keys("msa") 

login_field = driver.find_element(By.CSS_SELECTOR, "#password input")
login_field.send_keys("1234567890") 

time.sleep(1)

submit_button = driver.find_element(By.CSS_SELECTOR, ".p-d-flex.p-flex-column.w-full.p-gap-2 button")
submit_button.click()

time.sleep(10)

print("\n🔍 Шаг 3: Извлекаем все поля через JavaScript...")

# ИСПРАВЛЕННАЯ СТРОКА — JavaScript передан как аргумент
fields = driver.execute_script("""
const fields = [];
const inputs = document.querySelectorAll('input, select, textarea');
inputs.forEach(input => {
    const name = input.name || input.id || input.className || 'без_имени';
    let value;
    if (input.type === 'checkbox' || input.type === 'radio') {
        value = input.checked ? input.value : '';
    } else if (input.type === 'file') {
        value = input.files.length > 0 ? input.files[0].name : '';
    } else {
        value = input.value;
    }
    if (value) {
        fields.push({name: name, value: value, type: input.type, tagName: input.tagName.toLowerCase()});
    }
});
return fields;
""")

print("\n=== ДАННЫЕ ФОРМЫ ===")
for i, f in enumerate(fields):
    print(f"{i+1}. {f['name']} ({f['tagName']}/{f['type']}): {f['value']}")

timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
csv_file = f"form_data_{timestamp}.csv"
with open(csv_file, "w", encoding="utf-8-sig", newline="") as f:
    writer = csv.DictWriter(f, fieldnames=["Название", "Тип", "Значение"])
    writer.writeheader()
    writer.writerows([{"Название": f["name"], "Тип": f["type"], "Значение": f["value"]} for f in fields])

print(f"\n✅ Сохранено: {csv_file}")

driver.quit()
