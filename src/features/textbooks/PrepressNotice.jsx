import { Link } from 'react-router-dom'
import { isPrepress } from '../mybook/myBook.js'
import styles from './PrepressNotice.module.css'

/** A book that is not in classrooms yet says so wherever it is read; `current` is the printing teachers use now. */
export default function PrepressNotice({ book, current = null }) {
    if (!isPrepress(book?.edition_name)) return null
    return (
        <p className={styles.notice} role="note">
            这是 2024 修订版的印前样本（网友提供），2027 年春季起使用，内容以正式印刷本为准。
            {current ? <> 本学期在用旧版的老师请看<Link to={`/textbooks/${current.edition_id}`}>{current.edition_name} {current.title}</Link>。</> : null}
        </p>
    )
}
