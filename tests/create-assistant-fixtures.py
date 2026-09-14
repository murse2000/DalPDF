"""문서 도우미의 출처·숫자 변경·페이지 삽입 검증용 PDF를 만듭니다."""
from pathlib import Path
from reportlab.pdfgen.canvas import Canvas

root = Path(__file__).parent
before = [
    ['DalPDF AI verification fixture - fictional specifications',
     'Motor driver guide',
     'The driver controls the motor speed using a PWM signal.',
     'A higher PWM duty cycle makes the motor rotate faster.',
     'The operating voltage range is 3.3 V to 5 V.',
     'The maximum current is 2 A.',
     'Enable the driver only after the supply voltage is stable.'],
    ['Protection and maintenance',
     'The driver shuts down when the temperature exceeds 85 C.',
     'Disconnect the power supply before replacing the motor.',
     'Inspect the wiring every 30 days.',
     'The warranty lasts for 12 months from the purchase date.'],
]
after = [['Revision 2 - inserted cover page']] + [list(lines) for lines in before]
after[1][4] = 'The operating voltage range is 5 V to 12 V.'
after[1][6] = 'Enable the driver only after the supply voltage is stable and the cover is closed.'
after[2][3] = 'Inspect the wiring every 15 days.'
for name, pages in [('assistant-before.pdf', before), ('assistant-after.pdf', after)]:
    canvas = Canvas(str(root / name), pagesize=(612, 792))
    for lines in pages:
        canvas.setFont('Helvetica', 12)
        for i, line in enumerate(lines):
            canvas.drawString(35, 740 - 42 * i, line)
        canvas.showPage()
    canvas.save()
